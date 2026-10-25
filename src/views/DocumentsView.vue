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

/** 已就绪（可检索）文档数 */
const readyCount = computed(() => docs.value.filter((d) => d.status === 'ready').length)

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
    <div class="docs-inner">
      <!-- 页面头 -->
      <header class="page-head">
        <div class="page-heading">
          <span class="page-eyebrow">Knowledge Base</span>
          <h1>文档库</h1>
          <p>
            上传 PDF 论文，系统会自动解析、切分并建立向量索引。当前共
            <strong>{{ docs.length }}</strong> 篇，其中 <strong>{{ readyCount }}</strong> 篇可检索。
          </p>
        </div>
        <div class="page-actions">
          <span v-if="inProgress" class="processing-hint">
            <span class="pulse-dot"></span>
            处理中，自动刷新
          </span>
          <el-button :loading="loading" @click="refresh">
            <el-icon><Refresh /></el-icon>
            <span>刷新</span>
          </el-button>
        </div>
      </header>

      <!-- 上传区 -->
      <section class="upload-panel">
        <div class="upload-left">
          <el-upload
            v-model:file-list="uploadList"
            class="uploader"
            drag
            multiple
            :auto-upload="false"
            accept=".pdf"
            :limit="20"
          >
            <el-icon class="upload-icon"><UploadFilled /></el-icon>
            <div class="el-upload__text">
              拖拽 PDF 到此处，或<em>点击选择文件</em>
            </div>
            <template #tip>
              <div class="el-upload__tip">支持多文件上传，仅限 PDF；上传后异步解析与向量化</div>
            </template>
          </el-upload>
        </div>
        <div class="upload-aside">
          <h2>添加新的论文</h2>
          <p>解析与向量化在后台进行，可继续使用其他功能；处理完成的文档会出现在下表并自动刷新状态。</p>
          <div class="upload-actions">
            <el-button
              type="primary"
              :loading="uploading"
              :disabled="uploadList.length === 0"
              @click="doUpload"
            >
              <el-icon><Upload /></el-icon>
              <span>开始上传{{ uploadList.length ? `（${uploadList.length}）` : '' }}</span>
            </el-button>
            <span class="upload-count">
              {{ uploadList.length ? `已选择 ${uploadList.length} 个文件` : '尚未选择文件' }}
            </span>
          </div>
        </div>
      </section>

      <!-- 文档列表 -->
      <section class="table-panel">
        <div class="table-head">
          <h2>全部文档</h2>
          <span class="resize-hint">拖拽表头可调整列宽</span>
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
          <el-table-column label="文件名" prop="filename" min-width="240">
            <template #default="{ row }">
              <span class="file-cell" :title="row.filename">
                <span class="file-badge"><el-icon><Document /></el-icon></span>
                <span class="file-name">{{ row.filename }}</span>
              </span>
            </template>
          </el-table-column>
          <el-table-column label="状态" min-width="100" align="center">
            <template #default="{ row }">
              <el-tooltip v-if="row.status === 'failed' && row.error" :content="row.error" placement="top">
                <span class="status-pill" :class="`is-${statusTag(row.status).type}`">
                  <span class="status-dot"></span>
                  {{ statusTag(row.status).label }}
                </span>
              </el-tooltip>
              <span v-else class="status-pill" :class="`is-${statusTag(row.status).type}`">
                <span class="status-dot"></span>
                {{ statusTag(row.status).label }}
              </span>
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
      </section>
    </div>

    <!-- 文档详情对话框 -->
    <el-dialog v-model="detailVisible" :title="detailDoc?.filename" width="640px" v-loading="detailLoading">
      <template v-if="detailDoc">
        <div class="detail-grid">
          <div class="detail-row">
            <span class="detail-label">状态</span>
            <span class="detail-value">
              <el-tag :type="statusTag(detailDoc.status).type" size="small">
                {{ statusTag(detailDoc.status).label }}
              </el-tag>
            </span>
          </div>
          <div class="detail-row">
            <span class="detail-label">文档 ID</span>
            <span class="detail-value mono-text">{{ detailDoc.id }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">页数</span>
            <span class="detail-value">{{ detailDoc.page_count }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">分块数</span>
            <span class="detail-value">{{ detailDoc.chunk_count }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">大小</span>
            <span class="detail-value">{{ formatSize(detailDoc.size_bytes) }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">分块参数</span>
            <span class="detail-value">{{ detailDoc.chunk_size || '默认' }} / {{ detailDoc.chunk_overlap || '默认' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">创建时间</span>
            <span class="detail-value">{{ formatDate(detailDoc.created_at) }}</span>
          </div>
          <div v-if="detailDoc.content_hash" class="detail-row">
            <span class="detail-label">内容哈希</span>
            <span class="detail-value">
              <code class="hash-text">{{ detailDoc.content_hash }}</code>
            </span>
          </div>
          <div v-if="detailDoc.status === 'failed' && detailDoc.error" class="detail-row">
            <span class="detail-label">失败原因</span>
            <span class="detail-value error-text">{{ detailDoc.error }}</span>
          </div>
        </div>
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
  padding: 28px 24px 36px;
}
.docs-inner {
  width: 80%;
  max-width: none;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 22px;
}

/* ---------- 页面头 ---------- */
.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}
.page-eyebrow {
  display: block;
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--prf-text-4);
}
.page-heading h1 {
  margin: 0 0 6px;
  font-size: 28px;
  font-weight: 650;
  letter-spacing: -0.03em;
  color: var(--prf-text-1);
}
.page-heading p {
  margin: 0;
  font-size: 13px;
  line-height: 1.65;
  color: var(--prf-text-3);
}
.page-heading p strong {
  font-weight: 600;
  color: var(--prf-text-1);
}
.page-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 3px;
}
.processing-hint {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: color-mix(in srgb, var(--prf-warning) 74%, var(--prf-text-1));
}
.pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--prf-warning);
  animation: docs-pulse 1.4s ease-in-out infinite;
}
@keyframes docs-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
}

/* ---------- 上传区 ---------- */
.upload-panel {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
  gap: 26px;
  padding: 22px;
  background: var(--prf-surface);
  border: 1px solid var(--prf-border);
  border-radius: var(--prf-radius-lg);
  box-shadow: var(--prf-shadow-sm);
}
.upload-left {
  min-width: 0;
}
.uploader {
  width: 100%;
}
.uploader :deep(.el-upload) {
  width: 100%;
}
.uploader :deep(.el-upload-dragger) {
  padding: 26px 20px;
  background: var(--prf-surface-2);
  border: 1px dashed var(--prf-border-strong);
  border-radius: var(--prf-radius-md);
}
.uploader :deep(.el-upload-dragger:hover) {
  border-color: var(--prf-primary);
  background: var(--prf-active);
}
.upload-icon {
  margin-bottom: 8px;
  font-size: 34px;
  color: var(--prf-text-4);
}
.uploader :deep(.el-upload__text) {
  font-size: 13px;
  color: var(--prf-text-3);
}
.uploader :deep(.el-upload__text em) {
  font-style: normal;
  font-weight: 550;
  color: var(--prf-primary);
}
.uploader :deep(.el-upload__tip) {
  margin-top: 8px;
  font-size: 12px;
  color: var(--prf-text-4);
}
.upload-aside {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  padding: 4px 4px 4px 0;
}
.upload-aside h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  color: var(--prf-text-1);
}
.upload-aside p {
  margin: 0;
  font-size: 13px;
  line-height: 1.75;
  color: var(--prf-text-3);
}
.upload-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.upload-count {
  font-size: 12px;
  color: var(--prf-text-4);
}

/* ---------- 文档列表 ---------- */
.table-panel {
  background: var(--prf-surface);
  border: 1px solid var(--prf-border);
  border-radius: var(--prf-radius-lg);
  overflow: hidden;
}
.table-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px 10px;
}
.table-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  color: var(--prf-text-1);
}
.resize-hint {
  font-size: 12px;
  color: var(--prf-text-4);
}
.table-panel :deep(.el-table) {
  --el-table-border-color: var(--prf-border);
  --el-table-tr-bg-color: var(--prf-surface);
  --el-table-header-bg-color: var(--prf-surface-2);
  --el-table-row-hover-bg-color: var(--prf-surface-2);
  background: transparent;
  font-size: 13px;
}
/* 表头：小字距标签 + 细分隔线 */
.table-panel :deep(th.el-table__cell) {
  padding: 9px 0;
  border-right: 1px solid var(--prf-border) !important;
  border-bottom: 1px solid var(--prf-border) !important;
  background: var(--prf-surface-2) !important;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--prf-text-4);
}
.table-panel :deep(td.el-table__cell) {
  padding: 10px 0;
  border-right: none !important;
  border-bottom: 1px solid var(--prf-border) !important;
}
.table-panel :deep(.el-table__row:last-child td.el-table__cell) {
  border-bottom: none !important;
}
/* 隐藏外框线（保留 border 属性只是为了启用列宽拖拽） */
.table-panel :deep(.el-table--border:before),
.table-panel :deep(.el-table--border:after),
.table-panel :deep(.el-table--border .el-table__inner-wrapper:after),
.table-panel :deep(.el-table__inner-wrapper:before) {
  display: none;
}
.table-panel :deep(.el-table__empty-block) {
  min-height: 180px;
}
.table-panel :deep(.el-table__empty-text) {
  font-size: 13px;
  color: var(--prf-text-4);
}

.file-cell {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.file-badge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--prf-radius-xs);
  background: var(--prf-primary-soft);
  color: var(--prf-primary);
  font-size: 14px;
}
.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  color: var(--prf-text-1);
}

/* 状态胶囊 */
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.6;
}
.status-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}
.status-pill.is-success {
  color: color-mix(in srgb, var(--prf-success) 82%, var(--prf-text-1));
  background: color-mix(in srgb, var(--prf-success) 13%, transparent);
}
.status-pill.is-warning {
  color: color-mix(in srgb, var(--prf-warning) 74%, var(--prf-text-1));
  background: color-mix(in srgb, var(--prf-warning) 15%, transparent);
}
.status-pill.is-danger {
  color: var(--prf-danger);
  background: var(--prf-danger-bg);
}
.status-pill.is-info {
  color: var(--prf-text-3);
  background: var(--prf-surface-2);
}

.action-btns {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  white-space: nowrap;
}
.action-btns :deep(.el-button.is-link) {
  height: auto;
  padding: 4px 7px;
  border-radius: var(--prf-radius-xs);
  font-size: 13px;
}
.action-btns :deep(.el-button.is-link:hover) {
  background: var(--prf-hover);
}

.hash-text {
  font-family: var(--prf-font-mono);
  font-size: 12px;
  word-break: break-all;
}
.error-text {
  color: var(--prf-danger);
  white-space: pre-wrap;
}

/* 文档详情弹窗：定义列表布局，避免长串内容在窄格中异常断行 */
.detail-grid {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--prf-border);
  border-radius: var(--prf-radius-md);
  overflow: hidden;
}
.detail-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 11px 14px;
}
.detail-row + .detail-row {
  border-top: 1px solid var(--prf-border);
}
.detail-row:nth-child(odd) {
  background: var(--prf-surface-2);
}
.detail-label {
  flex-shrink: 0;
  width: 76px;
  font-size: 12.5px;
  font-weight: 550;
  color: var(--prf-text-3);
  padding-top: 2px;
  white-space: nowrap;
}
.detail-value {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--prf-text-1);
  word-break: break-all;
}
.detail-value .el-tag {
  margin-top: -2px;
}
.mono-text {
  font-family: var(--prf-font-mono);
  font-size: 12.5px;
  word-break: break-all;
}
.rechunk-tip {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--prf-text-3);
}

/* ---------- 响应式 ---------- */
@media (max-width: 960px) {
  .docs-inner {
    width: 100%;
  }
  .docs-view {
    padding: 22px 16px 28px;
  }
  .upload-panel {
    grid-template-columns: 1fr;
    gap: 18px;
  }
  .upload-aside {
    padding: 0;
  }
  .page-heading h1 {
    font-size: 24px;
  }
}
</style>
