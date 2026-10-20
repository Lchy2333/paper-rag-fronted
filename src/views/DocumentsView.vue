<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox, type TableInstance } from 'element-plus'
import type { UploadUserFile } from 'element-plus'
import { deleteDocument, getDocument, listDocuments, rechunkDocument, uploadDocuments } from '@/api/rag'
import { ApiError } from '@/api/client'
import type { RagDocument } from '@/api/ragTypes'

const docs = ref<RagDocument[]>([])
const loading = ref(false)
const uploading = ref(false)
const uploadList = ref<UploadUserFile[]>([])
const tableRef = ref<TableInstance>()

// ---------- 详情 / 重分块对话框 ----------
const detailDoc = ref<RagDocument | null>(null)
const detailVisible = ref(false)
const detailLoading = ref(false)

const rechunkDoc = ref<RagDocument | null>(null)
const rechunkVisible = ref(false)
const rechunkSubmitting = ref(false)
const rechunkForm = ref<{ chunk_size?: number; chunk_overlap?: number }>({})

let timer: number | undefined

/** 是否有文档正在处理（pending/processing）→ 触发轮询 */
const inProgress = computed(() =>
  docs.value.some((d) => d.status === 'pending' || d.status === 'processing'),
)

/** 刷新文档列表。silent=true 用于后台自动轮询：只更新数据，
 *  不触发按钮/表格 loading，避免处理期间每 5 秒闪一次；
 *  手动点击"刷新"或上传/删除后仍保留 loading 反馈。 */
async function refresh(opts?: { silent?: boolean }) {
  const silent = opts?.silent
  if (!silent) loading.value = true
  try {
    docs.value = await listDocuments()
  } catch (e) {
    if (!silent) ElMessage.error((e as ApiError).message)
  } finally {
    if (!silent) loading.value = false
  }
}

/**
 * 拖拽调整列宽后的钳制：
 * 1. 下限：不得窄于该列 min-width（避免创建时间被截断、操作按钮换行）；
 * 2. 上限：整表不产生横向溢出，防止把别的列挤出可视区（如把"大小"拉宽后"创建时间"消失）。
 * EP 已在鼠标松开时把拖拽宽度写进 column.width，这里覆盖后随后的 scheduleLayout 会按此值重新布局。
 */
function onHeaderDragEnd(
  newWidth: number,
  _oldWidth: number,
  column: { label?: string; minWidth?: number | string; width?: number; realWidth?: number },
) {
  const min = Number(column.minWidth) || 0
  let width = newWidth
  if (min) width = Math.max(width, min)

  const table: any = tableRef.value
  if (table?.$el) {
    // 可视宽度：优先取 EP 计算出的 body 宽度（已扣除纵向滚动条占位）
    const available =
      Number.parseFloat(String(table.bodyWidth?.value)) || (table.$el as HTMLElement).clientWidth - 16
    // 其余列已占用的宽度（已拖成固定宽的取 width，弹性列取 minWidth）
    const others = (table.store?.states.columns.value ?? [])
      .filter((c: any) => c.label !== column.label)
      .reduce((sum: number, c: any) => sum + (Number(c.width) || Number(c.minWidth) || 80), 0)
    const max = available - others
    width = Math.min(width, Math.max(max, min))
  }

  if (width !== newWidth) {
    column.width = width
    column.realWidth = width
  }
}

// ---------- 详情 ----------
async function openDetail(doc: RagDocument) {
  detailDoc.value = doc
  detailVisible.value = true
  detailLoading.value = true
  try {
    // 拉最新状态（处理进度 / 失败原因等）
    detailDoc.value = await getDocument(doc.id)
  } catch (e) {
    ElMessage.error((e as ApiError).message)
  } finally {
    detailLoading.value = false
  }
}

// ---------- 重分块 ----------
function openRechunk(doc: RagDocument) {
  rechunkDoc.value = doc
  rechunkForm.value = {}
  rechunkVisible.value = true
}

async function submitRechunk() {
  if (!rechunkDoc.value) return
  rechunkSubmitting.value = true
  try {
    const opts =
      rechunkForm.value.chunk_size || rechunkForm.value.chunk_overlap ? rechunkForm.value : {}
    await rechunkDocument(rechunkDoc.value.id, opts)
    ElMessage.success('已提交重新分块，处理中')
    rechunkVisible.value = false
    await refresh()
  } catch (e) {
    ElMessage.error((e as ApiError).message)
  } finally {
    rechunkSubmitting.value = false
  }
}

// ---------- 上传 ----------
async function doUpload() {
  // el-upload 的 raw 是 UploadRawFile（File 的子类型），直接传给后端
  const files: File[] = []
  for (const item of uploadList.value) {
    if (item.raw) files.push(item.raw)
  }
  if (files.length === 0) {
    ElMessage.warning('请先选择要上传的 PDF 文件')
    return
  }
  uploading.value = true
  try {
    const res = await uploadDocuments(files)
    ElMessage.success(
      `上传完成：成功 ${res.success_count}，重复 ${res.duplicate_count}，失败 ${res.failed_count}`,
    )
    res.results
      .filter((r) => !r.success)
      .forEach((r) => ElMessage.error(`${r.filename}：${r.error ?? '未知错误'}`))
    uploadList.value = []
    await refresh()
  } catch (e) {
    ElMessage.error((e as ApiError).message)
  } finally {
    uploading.value = false
  }
}

// ---------- 删除 ----------
async function onDelete(doc: RagDocument) {
  try {
    await ElMessageBox.confirm(
      `确认删除文档「${doc.filename}」？\n删除后其向量索引将一并移除。`,
      '删除文档',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await deleteDocument(doc.id)
    ElMessage.success('已删除')
    await refresh()
  } catch (e) {
    ElMessage.error((e as ApiError).message)
  }
}

// ---------- 状态展示辅助 ----------
function statusTag(status: string): { type: 'success' | 'warning' | 'danger' | 'info'; label: string } {
  switch (status) {
    case 'ready':
      return { type: 'success', label: '已就绪' }
    case 'pending':
      return { type: 'warning', label: '排队中' }
    case 'processing':
      return { type: 'warning', label: '处理中' }
    case 'failed':
      return { type: 'danger', label: '失败' }
    default:
      return { type: 'info', label: status }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  // 紧凑格式，避免在较窄列宽下被截断
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

onMounted(() => {
  refresh()
  timer = window.setInterval(() => {
    if (inProgress.value) refresh({ silent: true })
  }, 5000)
})

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<template>
  <div class="docs-view">
    <div class="docs-card upload-card">
      <div class="upload-left">
        <el-upload
          v-model:file-list="uploadList"
          drag
          multiple
          :auto-upload="false"
          accept=".pdf"
          :limit="20"
        >
          <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
          <div class="el-upload__text">
            拖拽 PDF 到此处，或<em>点击选择文件</em>
          </div>
          <template #tip>
            <div class="el-upload__tip">支持多文件上传，仅限 PDF；上传后异步解析与向量化</div>
          </template>
        </el-upload>
      </div>
      <div class="upload-right">
        <el-button
          type="primary"
          :loading="uploading"
          :disabled="uploadList.length === 0"
          @click="doUpload"
        >
          <el-icon><Upload /></el-icon>
          <span>开始上传{{ uploadList.length ? `（${uploadList.length}）` : '' }}</span>
        </el-button>
      </div>
    </div>

    <div class="docs-card table-card">
      <div class="table-head">
        <h3>文档列表</h3>
        <div class="table-tools">
          <span class="resize-hint">拖拽表头可调整列宽</span>
          <el-tag v-if="inProgress" type="warning" effect="light" size="small">
            有文档正在处理，已开启自动刷新
          </el-tag>
          <el-button :loading="loading" @click="refresh">
            <el-icon><Refresh /></el-icon>
            <span>刷新</span>
          </el-button>
        </div>
      </div>

      <el-table
        ref="tableRef"
        v-loading="loading"
        :data="docs"
        empty-text="文档库为空，先上传几篇论文吧"
        border
        allow-drag-last-column
        @header-dragend="onHeaderDragEnd"
      >
        <el-table-column label="文件名" prop="filename" min-width="240" show-overflow-tooltip />
        <el-table-column label="状态" min-width="100" align="center">
          <template #default="{ row }">
            <el-tooltip v-if="row.status === 'failed' && row.error" :content="row.error" placement="top">
              <el-tag :type="statusTag(row.status).type" size="small">{{ statusTag(row.status).label }}</el-tag>
            </el-tooltip>
            <el-tag v-else :type="statusTag(row.status).type" size="small">
              {{ statusTag(row.status).label }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="页数" prop="page_count" min-width="70" align="center" />
        <el-table-column label="分块" prop="chunk_count" min-width="70" align="center" />
        <el-table-column label="大小" min-width="100" align="center">
          <template #default="{ row }">{{ formatSize(row.size_bytes) }}</template>
        </el-table-column>
        <el-table-column label="创建时间" min-width="160" align="center" show-overflow-tooltip>
          <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="260" min-width="260" align="center" fixed="right">
          <template #default="{ row }">
            <span class="action-btns">
              <el-button type="primary" link @click="openDetail(row)">
                <el-icon><View /></el-icon>
                <span>详情</span>
              </el-button>
              <el-button type="warning" link @click="openRechunk(row)">
                <el-icon><RefreshRight /></el-icon>
                <span>重分块</span>
              </el-button>
              <el-button type="danger" link @click="onDelete(row)">
                <el-icon><Delete /></el-icon>
                <span>删除</span>
              </el-button>
            </span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 文档详情对话框 -->
    <el-dialog v-model="detailVisible" :title="detailDoc?.filename" width="520px" v-loading="detailLoading">
      <template v-if="detailDoc">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="状态">
            <el-tag :type="statusTag(detailDoc.status).type" size="small">
              {{ statusTag(detailDoc.status).label }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="文档 ID">{{ detailDoc.id }}</el-descriptions-item>
          <el-descriptions-item label="页数">{{ detailDoc.page_count }}</el-descriptions-item>
          <el-descriptions-item label="分块数">{{ detailDoc.chunk_count }}</el-descriptions-item>
          <el-descriptions-item label="大小">{{ formatSize(detailDoc.size_bytes) }}</el-descriptions-item>
          <el-descriptions-item label="分块参数">
            {{ detailDoc.chunk_size || '默认' }} / {{ detailDoc.chunk_overlap || '默认' }}
          </el-descriptions-item>
          <el-descriptions-item label="创建时间" :span="2">{{ formatDate(detailDoc.created_at) }}</el-descriptions-item>
          <el-descriptions-item v-if="detailDoc.content_hash" label="内容哈希" :span="2">
            <code class="hash-text">{{ detailDoc.content_hash }}</code>
          </el-descriptions-item>
          <el-descriptions-item v-if="detailDoc.status === 'failed' && detailDoc.error" label="失败原因" :span="2">
            <span class="error-text">{{ detailDoc.error }}</span>
          </el-descriptions-item>
        </el-descriptions>
      </template>
    </el-dialog>

    <!-- 重分块对话框 -->
    <el-dialog v-model="rechunkVisible" title="重新分块" width="440px">
      <p class="rechunk-tip">
        对「{{ rechunkDoc?.filename }}」删除全部旧分块后按新参数重新分块入库（较慢，期间旧分块仍可用）。不填则使用文档当前参数。
      </p>
      <el-form label-width="90px">
        <el-form-item label="分块大小">
          <el-input-number v-model="rechunkForm.chunk_size" :min="100" :max="8000" :step="100" placeholder="默认" />
        </el-form-item>
        <el-form-item label="重叠字符数">
          <el-input-number v-model="rechunkForm.chunk_overlap" :min="0" :max="2000" :step="10" placeholder="默认" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rechunkVisible = false">取消</el-button>
        <el-button type="primary" :loading="rechunkSubmitting" @click="submitRechunk">开始重分块</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.docs-view {
  height: 100%;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.docs-card {
  background: var(--prf-surface);
  border: 1px solid var(--prf-border);
  border-radius: 12px;
  padding: 16px 20px;
  box-shadow: var(--prf-shadow-sm);
}

.upload-card {
  display: flex;
  align-items: center;
  gap: 20px;
}
.upload-left {
  flex: 1;
}
.upload-right {
  flex-shrink: 0;
}

.table-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.table-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.table-head h3 {
  margin: 0;
  font-size: 15px;
  color: var(--prf-text-1);
}
.table-tools {
  display: flex;
  align-items: center;
  gap: 10px;
}
.resize-hint {
  font-size: 12px;
  color: var(--prf-text-4);
}
.table-card :deep(.el-table) {
  flex: 1;
}
.action-btns {
  /* 三个操作按钮强制单行，避免列宽不足时换行挤压 */
  white-space: nowrap;
}

/* 无框式表格：只在表头行保留分隔线，便于识别列边界和拖拽位置；数据行保持无框 */
.table-card :deep(.el-table td.el-table__cell) {
  border-right: none !important;
  border-bottom: none !important;
}
/* 表头行：只保留竖线（列边界/拖拽位置），不要底部横线；加粗 + 加深色让列边界更清晰 */
.table-card :deep(.el-table th.el-table__cell) {
  border-right: 2px solid var(--el-border-color) !important;
  border-bottom: none !important;
}
/* 隐藏外框线（保留 border 属性只是为了启用列宽拖拽） */
.table-card :deep(.el-table--border:before),
.table-card :deep(.el-table--border:after),
.table-card :deep(.el-table--border .el-table__inner-wrapper:after),
.table-card :deep(.el-table__inner-wrapper:before) {
  display: none;
}
.hash-text {
  font-size: 12px;
  word-break: break-all;
}
.error-text {
  color: var(--prf-danger);
  white-space: pre-wrap;
}
.rechunk-tip {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--prf-text-3);
}
</style>
