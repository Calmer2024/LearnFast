# LearnFast

LearnFast 是本地优先的个人知识库学习助手。当前代码实现覆盖 MVP01-06：

- MVP01：React + Python 本地应用骨架、健康检查、本地数据目录和 SQLite 初始化。
- MVP02：用户自带模型密钥配置、聊天模型和向量模型分开配置、连接测试、默认模型选择。
- MVP03：学习空间创建、进入、归档、恢复、删除和空间隔离。
- MVP04：资料上传、网页/YouTube 导入、MarkItDown 转 Markdown、状态跟踪、预览、启停、删除和重试。
- MVP05：Markdown 结构化分块、本地持久化索引、embedding 生成、引用片段定位和空间内检索。
- MVP06：空间内学习问答、流式 RAG 回答、来源范围选择、MQE/HyDE 增强检索、引用展示、回答保存为笔记和反馈记录。
- 系统控制台：前端可展开/折叠控制台，透明展示空间、模型、资料处理、检索、RAG、问答、笔记和反馈等核心处理日志。

## 本地启动

后端使用 Conda 环境 `learn-fast`（Python 3.12）：

```powershell
conda create -n learn-fast python=3.12 -y
conda activate learn-fast
python -m pip install -r apps\api\requirements.txt
uvicorn learnfast.main:app --app-dir apps\api --host 127.0.0.1 --port 8000 --reload
```

前端使用 Node.js：

```powershell
npm install --prefix apps\web
npm --prefix apps\web run dev
```

打开：

- 前端：<http://127.0.0.1:5173>
- 后端健康检查：<http://127.0.0.1:8000/api/health>
- 后端 OpenAPI：<http://127.0.0.1:8000/docs>

## 本地数据

默认数据目录为项目根目录下的 `.learnfast-data/`，包含：

- `learnfast.sqlite`：空间、模型配置、资料、任务状态。
- `raw/`：原始上传资料。
- `markdown/`：MarkItDown 转换后的 Markdown。
- `secrets/`：当系统凭据管理器不可用时的本地密钥 fallback。

`.learnfast-data/` 已在 `.gitignore` 中忽略。

## 模型配置

当前 MVP 将模型配置拆成两个独立链路：

- 聊天模型：仅支持 DeepSeek provider，用于学习问答、计划生成、报告生成、记忆提取等生成任务。默认模型为 `deepseek-v4-flash`，也可选择 `deepseek-v4-pro`。
- 向量模型：仅支持 Qwen provider 的 `text-embedding-v4`，用于资料分块向量化、RAG 检索和相似度召回。未配置向量 provider 时，MVP 会使用本地 deterministic hash embedding 跑通索引流程。

Qwen 向量模型使用 Model Studio / DashScope 的 OpenAI-compatible embeddings API。需要填写带 WorkspaceId 的 Base URL，例如：

```text
https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
```

## 环境变量

可选环境变量：

```powershell
$env:LEARNFAST_DATA_DIR="D:\Path\To\LearnFastData"
```

前端默认调用 `http://127.0.0.1:8000/api`。如需覆盖：

```powershell
$env:VITE_API_BASE_URL="http://127.0.0.1:8000/api"
```

## 当前边界

- 第一阶段是本地单用户版本，没有账号和云同步。
- 资料转换依赖 MarkItDown；文本/文档/表格类资料已加入自动转换测试，复杂扫描件、长音频、YouTube 字幕不可用时可能失败。
- MVP06 未配置聊天模型时会使用本地摘录式回答兜底；配置 DeepSeek 聊天模型后会通过 OpenAI-compatible chat completions 流式生成回答。

## 测试

验证文本、文档、表格类资料是否能转 Markdown：

```powershell
conda activate learn-fast
python tests\test_markitdown_formats.py
```

当前覆盖：MD、TXT、CSV、XLSX、DOCX、PPTX、PDF、EPub。

验证分块、索引、引用定位、重新索引和删除过滤：

```powershell
conda activate learn-fast
python tests\test_indexing_pipeline.py
```

验证学习问答检索增强、来源范围隔离和本地回答兜底：

```powershell
conda activate learn-fast
python tests\test_rag_chat.py
```

验证系统控制台日志写入、空间过滤和增量查询：

```powershell
conda activate learn-fast
python tests\test_system_console.py
```
