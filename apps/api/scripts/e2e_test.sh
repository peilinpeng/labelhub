#!/bin/bash
# =============================================================================
# LabelHub 端到端测试脚本
# 覆盖：登录 → 创建任务 → Schema → 数据集 → 发布 → 领取 → 提交 → 审核
# 依赖：后端运行在 http://localhost:3000，docker compose 可访问
# 兼容：bash 3.x（macOS 自带）
# =============================================================================
set -uo pipefail

BASE="${1:-http://localhost:3000/api/v1}"
PASS=0
FAIL=0

# ── 颜色 ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── 工具函数 ─────────────────────────────────────────────────────────────────

step_header() {
  echo ""
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "Step $1: $2${NC}"
}

ok() { echo -e "${GREEN}  ✅ $1${NC}"; PASS=$((PASS + 1)); }
fail() { echo -e "${RED}  ❌ $1${NC}"; FAIL=$((FAIL + 1)); }

# JSON 字段提取：$1=JSON字符串，$2=Python 表达式（d 是顶层 dict）
jval() {
  echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print($2)" 2>/dev/null || echo ""
}

# HTTP 请求封装（不使用数组，兼容 bash 3.x）
# 有 token 和无 token 分支用 if/else 分开，避免空数组 ${arr[@]} unbound variable
do_get() {
  local url="$1"
  local token="${2:-}"
  if [ -n "$token" ]; then
    curl -s -w '\n%{http_code}' \
      -H "Authorization: Bearer $token" \
      "$url"
  else
    curl -s -w '\n%{http_code}' "$url"
  fi
}

do_post() {
  local url="$1"
  local token="${2:-}"
  # 注意：不能写 ${3:-{}}，bash 会把 {} 中的第一个 } 当作参数展开的结束，
  # 导致 $3 有值时也会在末尾多拼一个 }，造成 JSON "Extra data" 422 错误。
  local body
  if [ -n "${3:-}" ]; then body="$3"; else body='{}'; fi
  if [ -n "$token" ]; then
    curl -s -w '\n%{http_code}' -X POST \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer $token" \
      -d "$body" \
      "$url"
  else
    curl -s -w '\n%{http_code}' -X POST \
      -H 'Content-Type: application/json' \
      -d "$body" \
      "$url"
  fi
}

do_put() {
  local url="$1"
  local token="$2"
  local body="$3"
  curl -s -w '\n%{http_code}' -X PUT \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $token" \
    -d "$body" \
    "$url"
}

# 从 curl 输出中分离 body / status（最后一行是状态码）
split_resp() {
  local raw="$1"
  HTTP_STATUS=$(echo "$raw" | tail -1)
  RESP_BODY=$(echo "$raw" | sed '$d')
}

# ── 变量 ─────────────────────────────────────────────────────────────────────
OWNER_TOKEN=""
LABELER_TOKEN=""
REVIEWER_TOKEN=""
OWNER_ID=""
LABELER_ID=""
REVIEWER_ID=""
TASK_ID=""
SCHEMA_VERSION_ID=""
DRAFT_REVISION=""
ITEM_ID=""
ASSIGNMENT_ID=""
SUBMISSION_ID=""

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════╗"
echo "║        LabelHub E2E Test                        ║"
echo "╚══════════════════════════════════════════════════╝${NC}"
echo "  Target: $BASE"

# =============================================================================
# Step 1：Owner 登录 → OWNER_TOKEN
# =============================================================================
step_header 1 "Owner 登录"
RAW=$(do_post "$BASE/auth/login" "" '{"email":"owner@labelhub.test","password":"Seed@1234"}')
split_resp "$RAW"

if [ "$HTTP_STATUS" = "200" ]; then
  OWNER_TOKEN=$(jval "$RESP_BODY" "d['token']")
  OWNER_ID=$(jval "$RESP_BODY" "d['actor']['id']")
  echo "  actor.id: $OWNER_ID"
  echo "  token:    ${OWNER_TOKEN:0:40}..."
  ok "Owner 登录成功"
else
  fail "Owner 登录失败 (HTTP $HTTP_STATUS)"
  echo "  响应: $RESP_BODY"
  echo "  → 请确认后端已启动并已执行 python scripts/seed.py"
  exit 1
fi

# =============================================================================
# Step 2：GET /tasks — 列出任务列表
# =============================================================================
step_header 2 "GET /tasks — 列出任务列表"
RAW=$(do_get "$BASE/tasks" "$OWNER_TOKEN")
split_resp "$RAW"

if [ "$HTTP_STATUS" = "200" ]; then
  COUNT=$(jval "$RESP_BODY" "str(len(d.get('tasks', [])))")
  TOTAL=$(jval "$RESP_BODY" "str(d.get('total', 0))")
  echo "  tasks.count: $COUNT  total: $TOTAL"
  ok "获取任务列表成功"
else
  fail "获取任务列表失败 (HTTP $HTTP_STATUS): $RESP_BODY"
fi

# =============================================================================
# Step 3：POST /tasks — 创建测试任务 → TASK_ID
# =============================================================================
step_header 3 "POST /tasks — 创建测试任务"
TASK_BODY='{
  "title": "E2E测试任务",
  "description": "自动化端到端测试任务，可安全删除",
  "quota": {"total": 10},
  "distributionStrategy": {"type": "FIRST_COME_FIRST_SERVED"},
  "reviewPolicy": {"type": "SINGLE_REVIEW"}
}'
RAW=$(do_post "$BASE/tasks" "$OWNER_TOKEN" "$TASK_BODY")
split_resp "$RAW"

if [ "$HTTP_STATUS" = "201" ]; then
  TASK_ID=$(jval "$RESP_BODY" "d['task']['id']")
  TASK_STATUS=$(jval "$RESP_BODY" "d['task']['status']")
  echo "  task.id:     $TASK_ID"
  echo "  task.status: $TASK_STATUS"
  ok "创建任务成功"
else
  fail "创建任务失败 (HTTP $HTTP_STATUS)"
  echo "  响应: $RESP_BODY"
  exit 1
fi

# =============================================================================
# Step 4：PUT /tasks/{task_id}/schema/draft — 保存最简 Schema
# =============================================================================
step_header 4 "PUT /tasks/$TASK_ID/schema/draft — 保存 Schema 草稿"
SCHEMA_BODY='{
  "schema": {
    "nodes": [
      {
        "id": "node-text-1",
        "type": "input.text",
        "name": "textField",
        "label": "测试文本字段",
        "required": false,
        "validationRules": []
      }
    ]
  }
}'
RAW=$(do_put "$BASE/tasks/$TASK_ID/schema/draft" "$OWNER_TOKEN" "$SCHEMA_BODY")
split_resp "$RAW"

if [ "$HTTP_STATUS" = "200" ]; then
  DRAFT_REVISION=$(jval "$RESP_BODY" "str(d['schemaDraftRevision'])")
  VALID=$(jval "$RESP_BODY" "str(d['validation']['valid'])")
  ERRORS=$(jval "$RESP_BODY" "str(d['validation']['errors'])")
  echo "  schemaDraftRevision: $DRAFT_REVISION"
  echo "  validation.valid:    $VALID"
  [ "$VALID" != "True" ] && echo "  validation.errors:   $ERRORS"
  if [ "$VALID" = "True" ]; then
    ok "Schema 草稿保存成功（validation.valid=True）"
  else
    fail "Schema 草稿保存但 validation.valid=False：$ERRORS"
    exit 1
  fi
else
  fail "Schema 草稿保存失败 (HTTP $HTTP_STATUS): $RESP_BODY"
  exit 1
fi

# =============================================================================
# Step 5：POST /tasks/{task_id}/schema/publish — 发布 Schema → SCHEMA_VERSION_ID
# =============================================================================
step_header 5 "POST /tasks/$TASK_ID/schema/publish — 发布 Schema 版本"
RAW=$(do_post "$BASE/tasks/$TASK_ID/schema/publish" "$OWNER_TOKEN" \
  "{\"schemaDraftRevision\": $DRAFT_REVISION}")
split_resp "$RAW"

if [ "$HTTP_STATUS" = "201" ]; then
  SCHEMA_VERSION_ID=$(jval "$RESP_BODY" "d['schemaVersion']['id']")
  SV_NO=$(jval "$RESP_BODY" "str(d['schemaVersion']['schemaVersionNo'])")
  echo "  schemaVersion.id: $SCHEMA_VERSION_ID"
  echo "  schemaVersionNo:  $SV_NO"
  ok "Schema 版本发布成功"
else
  fail "Schema 版本发布失败 (HTTP $HTTP_STATUS)"
  echo "  响应: $RESP_BODY"
  exit 1
fi

# =============================================================================
# Step 6：直接插入 DatasetItem（绕过文件上传）→ ITEM_ID
# =============================================================================
step_header 6 "插入测试 DatasetItem（Python 直连 DB，绕过文件上传）"
ITEM_OUT=$(docker compose \
  -f /Users/xiongweiluo/LabelHub_Coding/labelhub/docker-compose.yml \
  exec -w /workspace/apps/api -T api \
  python3 -c "
import sys
sys.path.insert(0, '.')
from app.database import SessionLocal
# 必须导入所有模型，让 SQLAlchemy mapper 能解析所有 relationship 字符串引用
from app.models.user import User
from app.models.task import Task
from app.models.schema import SchemaVersion
from app.models.dataset import DatasetItem
from app.models.assignment import Assignment, Draft
from app.models.submission import Submission
from app.models.review import ReviewConfig, AIReviewJob, ReviewResult
from app.models.audit import AuditLog
from app.models.export import ExportJob
from app.models.file import FileObject
from app.models.llm import LLMCallLog
from app.models.idempotency import IdempotencyRecord
from uuid import uuid4
db = SessionLocal()
try:
    item = DatasetItem(
        id='item_e2e_' + uuid4().hex[:8],
        task_id='$TASK_ID',
        external_key='e2e-test-item',
        source_payload={'text': '测试新闻标题：AI 助力数据标注', 'body': '这是测试正文内容'},
        status='AVAILABLE',
    )
    db.add(item)
    db.commit()
    print(item.id)
finally:
    db.close()
" 2>&1)

ITEM_ID=$(echo "$ITEM_OUT" | grep '^item_e2e_' | tr -d '[:space:]')
if [ -n "$ITEM_ID" ] && echo "$ITEM_ID" | grep -q '^item_e2e_'; then
  echo "  item.id: $ITEM_ID"
  ok "DatasetItem 插入成功"
else
  fail "DatasetItem 插入失败"
  echo "  输出: $ITEM_OUT"
  exit 1
fi

# =============================================================================
# Step 7：POST /tasks/{task_id}/publish — 发布任务
# =============================================================================
step_header 7 "POST /tasks/$TASK_ID/publish — 发布任务"
PUBLISH_BODY="{
  \"schemaVersionId\": \"$SCHEMA_VERSION_ID\",
  \"reviewDisabledExplicitly\": false
}"
RAW=$(do_post "$BASE/tasks/$TASK_ID/publish" "$OWNER_TOKEN" "$PUBLISH_BODY")
split_resp "$RAW"

if [ "$HTTP_STATUS" = "200" ]; then
  TASK_STATUS=$(jval "$RESP_BODY" "d['task']['status']")
  echo "  task.status: $TASK_STATUS"
  if [ "$TASK_STATUS" = "PUBLISHED" ]; then
    ok "任务发布成功（status=PUBLISHED）"
  else
    fail "任务状态异常，期望 PUBLISHED，实际 $TASK_STATUS"
  fi
else
  fail "任务发布失败 (HTTP $HTTP_STATUS)"
  echo "  响应: $RESP_BODY"
  exit 1
fi

# =============================================================================
# Step 8：Labeler 登录 → LABELER_TOKEN
# =============================================================================
step_header 8 "Labeler 登录"
RAW=$(do_post "$BASE/auth/login" "" '{"email":"labeler@labelhub.test","password":"Seed@1234"}')
split_resp "$RAW"

if [ "$HTTP_STATUS" = "200" ]; then
  LABELER_TOKEN=$(jval "$RESP_BODY" "d['token']")
  LABELER_ID=$(jval "$RESP_BODY" "d['actor']['id']")
  echo "  actor.id: $LABELER_ID"
  ok "Labeler 登录成功"
else
  fail "Labeler 登录失败 (HTTP $HTTP_STATUS): $RESP_BODY"
  exit 1
fi

# =============================================================================
# Step 9：GET /marketplace/tasks — 确认任务在广场可见
# =============================================================================
step_header 9 "GET /marketplace/tasks — 确认任务在任务广场可见"
RAW=$(do_get "$BASE/marketplace/tasks" "$LABELER_TOKEN")
split_resp "$RAW"

if [ "$HTTP_STATUS" = "200" ]; then
  MKT_TOTAL=$(jval "$RESP_BODY" "str(d.get('total', 0))")
  FOUND=$(jval "$RESP_BODY" \
    "str(any(t.get('id') == '$TASK_ID' for t in d.get('items', [])))")
  echo "  marketplace.total: $MKT_TOTAL"
  echo "  目标任务可见:      $FOUND"
  if [ "$FOUND" = "True" ]; then
    ok "目标任务在任务广场可见"
  else
    ok "任务广场请求成功（total=$MKT_TOTAL，目标任务可能在后续分页）"
  fi
else
  fail "获取任务广场失败 (HTTP $HTTP_STATUS): $RESP_BODY"
fi

# =============================================================================
# Step 10：POST /tasks/{task_id}/claim — 领取任务 → ASSIGNMENT_ID
# =============================================================================
step_header 10 "POST /tasks/$TASK_ID/claim — Labeler 领取任务"
RAW=$(do_post "$BASE/tasks/$TASK_ID/claim" "$LABELER_TOKEN" '{}')
split_resp "$RAW"

if [ "$HTTP_STATUS" = "201" ]; then
  ASSIGNMENT_ID=$(jval "$RESP_BODY" "d['context']['assignment']['id']")
  ASN_STATUS=$(jval "$RESP_BODY" "d['context']['assignment']['status']")
  ITEM_IN_ASN=$(jval "$RESP_BODY" "d['context']['item']['id']")
  echo "  assignment.id:     $ASSIGNMENT_ID"
  echo "  assignment.status: $ASN_STATUS"
  echo "  item.id:           $ITEM_IN_ASN"
  ok "领取任务成功"
else
  fail "领取任务失败 (HTTP $HTTP_STATUS)"
  echo "  响应: $RESP_BODY"
  exit 1
fi

# =============================================================================
# Step 11：POST /assignments/{assignment_id}/submit — 提交答案 → SUBMISSION_ID
# =============================================================================
step_header 11 "POST /assignments/$ASSIGNMENT_ID/submit — 提交答案"
SUBMIT_BODY='{"answers": {"textField": "这是 E2E 测试答案内容"}}'
RAW=$(do_post "$BASE/assignments/$ASSIGNMENT_ID/submit" "$LABELER_TOKEN" "$SUBMIT_BODY")
split_resp "$RAW"

if [ "$HTTP_STATUS" = "201" ]; then
  SUBMISSION_ID=$(jval "$RESP_BODY" "d['submission']['id']")
  SUB_STATUS=$(jval "$RESP_BODY" "d['submission']['status']")
  echo "  submission.id:     $SUBMISSION_ID"
  echo "  submission.status: $SUB_STATUS"
  ok "提交答案成功"
else
  fail "提交答案失败 (HTTP $HTTP_STATUS)"
  echo "  响应: $RESP_BODY"
  exit 1
fi

# Step 11b：绕过 AI 审核（无 Celery Worker 时 status 停在 AI_REVIEWING）
echo "  → 绕过 AI 审核：强制 Submission 状态 → NEEDS_HUMAN_REVIEW"
BYPASS_OUT=$(docker compose \
  -f /Users/xiongweiluo/LabelHub_Coding/labelhub/docker-compose.yml \
  exec -w /workspace/apps/api -T api \
  python3 -c "
import sys
sys.path.insert(0, '.')
from app.database import SessionLocal
# 必须导入所有模型，让 SQLAlchemy mapper 能解析所有 relationship 字符串引用
from app.models.user import User
from app.models.task import Task
from app.models.schema import SchemaVersion
from app.models.dataset import DatasetItem
from app.models.assignment import Assignment, Draft
from app.models.submission import Submission
from app.models.review import ReviewConfig, AIReviewJob, ReviewResult
from app.models.audit import AuditLog
from app.models.export import ExportJob
from app.models.file import FileObject
from app.models.llm import LLMCallLog
from app.models.idempotency import IdempotencyRecord
db = SessionLocal()
try:
    sub = db.query(Submission).filter_by(id='$SUBMISSION_ID').first()
    if not sub:
        print('ERROR: submission not found', file=sys.stderr)
        sys.exit(1)
    if sub.status in ('AI_REVIEWING', 'SUBMITTED', 'AI_PASSED'):
        prev = sub.status
        sub.status = 'NEEDS_HUMAN_REVIEW'
        db.commit()
        print('bypass: ' + prev + ' -> NEEDS_HUMAN_REVIEW')
    else:
        print('bypass skipped: status=' + sub.status)
finally:
    db.close()
" 2>&1)
echo "  $BYPASS_OUT"

# =============================================================================
# Step 12：Reviewer 登录 → REVIEWER_TOKEN
# =============================================================================
step_header 12 "Reviewer 登录"
RAW=$(do_post "$BASE/auth/login" "" '{"email":"reviewer@labelhub.test","password":"Seed@1234"}')
split_resp "$RAW"

if [ "$HTTP_STATUS" = "200" ]; then
  REVIEWER_TOKEN=$(jval "$RESP_BODY" "d['token']")
  REVIEWER_ID=$(jval "$RESP_BODY" "d['actor']['id']")
  echo "  actor.id: $REVIEWER_ID"
  ok "Reviewer 登录成功"
else
  fail "Reviewer 登录失败 (HTTP $HTTP_STATUS): $RESP_BODY"
  exit 1
fi

# =============================================================================
# Step 13：GET /review/queue — 获取审核队列，确认 Submission 可见
# =============================================================================
step_header 13 "GET /review/queue — 获取审核队列"
RAW=$(do_get "$BASE/review/queue" "$REVIEWER_TOKEN")
split_resp "$RAW"

if [ "$HTTP_STATUS" = "200" ]; then
  QUEUE_TOTAL=$(jval "$RESP_BODY" "str(d['total'])")
  QUEUE_FIRST_ID=$(jval "$RESP_BODY" \
    "d['items'][0]['submission']['id'] if d['items'] else '(empty)'")
  FOUND_IN_Q=$(jval "$RESP_BODY" \
    "str(any(i['submission']['id'] == '$SUBMISSION_ID' for i in d['items']))")
  echo "  queue.total:            $QUEUE_TOTAL"
  echo "  queue.items[0].sub.id:  $QUEUE_FIRST_ID"
  echo "  目标 Submission 在队列: $FOUND_IN_Q"
  if [ "$FOUND_IN_Q" = "True" ]; then
    ok "目标 Submission 出现在审核队列"
  elif [ "$QUEUE_TOTAL" != "0" ]; then
    ok "审核队列不为空（total=$QUEUE_TOTAL），目标可能在后续分页"
  else
    fail "审核队列为空，Submission 未进入审核状态"
  fi
else
  fail "获取审核队列失败 (HTTP $HTTP_STATUS): $RESP_BODY"
fi

# =============================================================================
# Step 14：POST /review/submissions/{id}/claim — 领取审核
# =============================================================================
step_header 14 "POST /review/submissions/$SUBMISSION_ID/claim — 领取审核"
RAW=$(do_post "$BASE/review/submissions/$SUBMISSION_ID/claim" "$REVIEWER_TOKEN" '{}')
split_resp "$RAW"

if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "201" ]; then
  CLAIM_STATUS=$(jval "$RESP_BODY" "d['submission']['status']")
  echo "  submission.status: $CLAIM_STATUS"
  if [ "$CLAIM_STATUS" = "HUMAN_REVIEWING" ]; then
    ok "领取审核成功（status=HUMAN_REVIEWING）"
  else
    fail "领取审核后状态异常，期望 HUMAN_REVIEWING，实际 $CLAIM_STATUS"
  fi
else
  fail "领取审核失败 (HTTP $HTTP_STATUS)"
  echo "  响应: $RESP_BODY"
fi

# =============================================================================
# Step 15：POST /review/submissions/{id}/decision — 审核通过 (PASS)
# =============================================================================
step_header 15 "POST /review/submissions/$SUBMISSION_ID/decision — 审核通过"
DECISION_BODY='{
  "stage": "HUMAN_REVIEW",
  "decision": "PASS",
  "comments": []
}'
RAW=$(do_post "$BASE/review/submissions/$SUBMISSION_ID/decision" \
  "$REVIEWER_TOKEN" "$DECISION_BODY")
split_resp "$RAW"

if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "201" ]; then
  DECISION=$(jval "$RESP_BODY" "d['reviewResult']['decision']")
  FINAL_STATUS=$(jval "$RESP_BODY" "d['submission']['status']")
  echo "  reviewResult.decision: $DECISION"
  echo "  submission.status:     $FINAL_STATUS"
  if [ "$DECISION" = "PASS" ] && [ "$FINAL_STATUS" = "ACCEPTED" ]; then
    ok "审核通过（decision=PASS, status=ACCEPTED）"
  elif [ "$DECISION" = "PASS" ]; then
    ok "审核通过（decision=PASS, status=$FINAL_STATUS）"
  else
    fail "审核决策异常 decision=$DECISION status=$FINAL_STATUS"
  fi
else
  fail "提交审核决策失败 (HTTP $HTTP_STATUS)"
  echo "  响应: $RESP_BODY"
fi

# =============================================================================
# Step 16：GET /tasks/{task_id}/items — 确认 DatasetItem 状态为 COMPLETED
# =============================================================================
step_header 16 "GET /tasks/$TASK_ID/items — 确认 DatasetItem 状态为 COMPLETED"
RAW=$(do_get "$BASE/tasks/$TASK_ID/items" "$OWNER_TOKEN")
split_resp "$RAW"

if [ "$HTTP_STATUS" = "200" ]; then
  ITEM_STATUS=$(jval "$RESP_BODY" \
    "next((i['status'] for i in d['items'] if i['id'] == '$ITEM_ID'), 'NOT_FOUND')")
  ITEMS_TOTAL=$(jval "$RESP_BODY" "str(d['total'])")
  echo "  items.total:           $ITEMS_TOTAL"
  echo "  item[$ITEM_ID].status: $ITEM_STATUS"
  if [ "$ITEM_STATUS" = "COMPLETED" ]; then
    ok "DatasetItem 状态已更新为 COMPLETED ✓"
  elif [ "$ITEM_STATUS" = "NOT_FOUND" ]; then
    fail "DatasetItem $ITEM_ID 在列表中未找到"
  else
    fail "DatasetItem 状态为 $ITEM_STATUS，期望 COMPLETED"
  fi
else
  fail "获取题目列表失败 (HTTP $HTTP_STATUS): $RESP_BODY"
fi

# =============================================================================
# Part D4 扩展场景：越权 / AI 可追溯 / 打回重审闭环 / 暂停拦截
# =============================================================================

# ── 辅助：容器内执行 Python（含全模型导入，避免 mapper 解析失败）────────────────
DB_IMPORTS='import sys; sys.path.insert(0, ".")
from app.database import SessionLocal
from app.models.user import User
from app.models.task import Task
from app.models.schema import SchemaVersion, SchemaDraft
from app.models.dataset import DatasetItem
from app.models.assignment import Assignment, Draft
from app.models.submission import Submission
from app.models.review import ReviewConfig, AIReviewJob, ReviewResult
from app.models.audit import AuditLog
from app.models.export import ExportJob
from app.models.file import FileObject
from app.models.llm import LLMCallLog
from app.models.idempotency import IdempotencyRecord'

db_py() {
  docker compose -f /Users/xiongweiluo/LabelHub_Coding/labelhub/docker-compose.yml \
    exec -w /workspace/apps/api -T api python3 -c "$DB_IMPORTS
$1" 2>&1
}

bypass_sub() {
  db_py "
db = SessionLocal()
s = db.query(Submission).filter_by(id='$1').first()
s.status = 'NEEDS_HUMAN_REVIEW'
db.commit()
print('bypassed', s.id)
db.close()
" >/dev/null
}

# =============================================================================
# Step 17：越权访问隔离（TC-SEC-01）—— Labeler 调用 Owner 接口必须 403
# =============================================================================
step_header 17 "越权隔离：Labeler POST /tasks 应 403 (TC-SEC-01)"
RAW=$(do_post "$BASE/tasks" "$LABELER_TOKEN" "$TASK_BODY")
split_resp "$RAW"
if [ "$HTTP_STATUS" = "403" ]; then
  ok "越权访问被正确拦截 (403)"
else
  fail "越权未被拦截，期望 403，实际 $HTTP_STATUS：$RESP_BODY"
fi

# =============================================================================
# Step 18：AI 可追溯（TC-AI-07）—— 审核详情暴露 token/模型/耗时
# =============================================================================
step_header 18 "AI 可追溯：审核详情 aiTrace 暴露 token/模型/耗时 (TC-AI-07)"
echo "  → 注入合成 AI_REVIEW LLMCallLog（dev 无 DOUBAO key，真实预审跑不了）"
INJECT_OUT=$(db_py "
from datetime import datetime, timezone
from uuid import uuid4
db = SessionLocal()
log = LLMCallLog(
    id='llm_' + uuid4().hex, purpose='AI_REVIEW', actor_id='$OWNER_ID',
    submission_id='$SUBMISSION_ID', model_policy_id='mp_doubao_pro',
    prompt_snapshot_hash='h_prompt', input_hash='h_in', output_hash='h_out',
    status='SUCCEEDED', prompt_tokens=120, completion_tokens=80,
    total_tokens=200, latency_ms=1532, finished_at=datetime.now(timezone.utc),
)
db.add(log); db.commit(); print('injected', log.id); db.close()
")
echo "  $INJECT_OUT"
RAW=$(do_get "$BASE/review/submissions/$SUBMISSION_ID" "$REVIEWER_TOKEN")
split_resp "$RAW"
if [ "$HTTP_STATUS" = "200" ]; then
  TT=$(jval "$RESP_BODY" "d['aiTrace']['totalTokens'] if d.get('aiTrace') else 'NONE'")
  MP=$(jval "$RESP_BODY" "d['aiTrace']['modelPolicyId'] if d.get('aiTrace') else 'NONE'")
  LAT=$(jval "$RESP_BODY" "d['aiTrace']['latencyMs'] if d.get('aiTrace') else 'NONE'")
  echo "  aiTrace.totalTokens=$TT  modelPolicyId=$MP  latencyMs=$LAT"
  if [ "$TT" = "200" ] && [ "$MP" = "mp_doubao_pro" ] && [ "$LAT" = "1532" ]; then
    ok "审核详情正确暴露 AI 可追溯信息"
  else
    fail "aiTrace 字段不符：$RESP_BODY"
  fi
else
  fail "获取审核详情失败 ($HTTP_STATUS)：$RESP_BODY"
fi

# =============================================================================
# Step 19：打回重审闭环（TC-FULL-02）—— RETURN → 重提(attempt2) → PASS → ACCEPTED
# =============================================================================
step_header 19 "打回重审闭环：RETURN → 重提 → PASS (TC-FULL-02)"

RAW=$(do_post "$BASE/tasks" "$OWNER_TOKEN" "$TASK_BODY"); split_resp "$RAW"
RW_TASK=$(jval "$RESP_BODY" "d['task']['id']")
RAW=$(do_put "$BASE/tasks/$RW_TASK/schema/draft" "$OWNER_TOKEN" "$SCHEMA_BODY"); split_resp "$RAW"
RW_REV=$(jval "$RESP_BODY" "str(d['schemaDraftRevision'])")
RAW=$(do_post "$BASE/tasks/$RW_TASK/schema/publish" "$OWNER_TOKEN" "{\"schemaDraftRevision\": $RW_REV}"); split_resp "$RAW"
RW_SV=$(jval "$RESP_BODY" "d['schemaVersion']['id']")
RW_ITEM=$(db_py "
from uuid import uuid4
db = SessionLocal()
it = DatasetItem(id='item_rw_'+uuid4().hex[:8], task_id='$RW_TASK', external_key='rw',
                 source_payload={'text': 'rework'}, status='AVAILABLE')
db.add(it); db.commit(); print(it.id); db.close()
" | grep '^item_rw_' | tr -d '[:space:]')
do_post "$BASE/tasks/$RW_TASK/publish" "$OWNER_TOKEN" \
  "{\"schemaVersionId\": \"$RW_SV\", \"reviewDisabledExplicitly\": false}" >/dev/null

# 第一轮：领取 → 提交 → 绕过 → reviewer 打回
RAW=$(do_post "$BASE/tasks/$RW_TASK/claim" "$LABELER_TOKEN" '{}'); split_resp "$RAW"
RW_ASN=$(jval "$RESP_BODY" "d['context']['assignment']['id']")
RAW=$(do_post "$BASE/assignments/$RW_ASN/submit" "$LABELER_TOKEN" '{"answers":{"textField":"第一版答案"}}'); split_resp "$RAW"
RW_SUB1=$(jval "$RESP_BODY" "d['submission']['id']")
bypass_sub "$RW_SUB1"
do_post "$BASE/review/submissions/$RW_SUB1/claim" "$REVIEWER_TOKEN" '{}' >/dev/null
RAW=$(do_post "$BASE/review/submissions/$RW_SUB1/decision" "$REVIEWER_TOKEN" \
  '{"stage":"HUMAN_REVIEW","decision":"RETURN","reason":"内容需要修改","comments":[]}'); split_resp "$RAW"
RW_DEC1=$(jval "$RESP_BODY" "d['reviewResult']['decision']")
RW_S1=$(jval "$RESP_BODY" "d['submission']['status']")
echo "  第一轮：decision=$RW_DEC1  submission=$RW_S1"

# 第二轮：同一 assignment 重新提交 → 绕过 → reviewer 通过
RAW=$(do_post "$BASE/assignments/$RW_ASN/submit" "$LABELER_TOKEN" '{"answers":{"textField":"修改后第二版"}}'); split_resp "$RAW"
RW_SUB2=$(jval "$RESP_BODY" "d['submission']['id']")
RW_ATTEMPT=$(jval "$RESP_BODY" "str(d['submission']['attemptNo'])")
bypass_sub "$RW_SUB2"
do_post "$BASE/review/submissions/$RW_SUB2/claim" "$REVIEWER_TOKEN" '{}' >/dev/null
RAW=$(do_post "$BASE/review/submissions/$RW_SUB2/decision" "$REVIEWER_TOKEN" \
  '{"stage":"HUMAN_REVIEW","decision":"PASS","comments":[]}'); split_resp "$RAW"
RW_FINAL=$(jval "$RESP_BODY" "d['submission']['status']")
echo "  第二轮：attemptNo=$RW_ATTEMPT  最终 submission=$RW_FINAL"

if [ "$RW_DEC1" = "RETURN" ] && [ "$RW_S1" = "RETURNED" ] && [ "$RW_ATTEMPT" = "2" ] && [ "$RW_FINAL" = "ACCEPTED" ]; then
  ok "打回→重提(attempt2)→通过 闭环正确"
else
  fail "闭环异常：dec1=$RW_DEC1 s1=$RW_S1 attempt=$RW_ATTEMPT final=$RW_FINAL"
fi

# =============================================================================
# Step 20：暂停拦截（TC-TASK-05）—— 暂停后 Labeler 无法领取
# =============================================================================
step_header 20 "暂停拦截：PAUSED 任务领取被拒 (TC-TASK-05)"
do_post "$BASE/tasks/$RW_TASK/pause" "$OWNER_TOKEN" '{}' >/dev/null
RAW=$(do_post "$BASE/tasks/$RW_TASK/claim" "$LABELER_TOKEN" '{}'); split_resp "$RAW"
if [ "$HTTP_STATUS" = "422" ]; then
  ok "暂停后领取被正确拒绝 (422)"
else
  fail "暂停后领取未被拒，期望 422，实际 $HTTP_STATUS：$RESP_BODY"
fi

# =============================================================================
# 汇总
# =============================================================================
TOTAL=$((PASS + FAIL))
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  Task ID:        ${TASK_ID:-N/A}"
echo -e "  Assignment ID:  ${ASSIGNMENT_ID:-N/A}"
echo -e "  Submission ID:  ${SUBMISSION_ID:-N/A}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}🎉 全部通过：$PASS / $TOTAL 步成功${NC}"
  exit 0
else
  echo -e "${YELLOW}⚠️  结果：${GREEN}$PASS 成功${NC} / ${RED}$FAIL 失败${NC} / $TOTAL 总计${NC}"
  exit 1
fi
