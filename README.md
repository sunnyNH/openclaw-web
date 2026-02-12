# OpenClaw Web

OpenClaw Web 是一个基于 Vue 3 + Naive UI 的 OpenClaw Gateway 管理后台，目标是替代默认控制台 UI，提供更清晰的运维与配置体验。

![OpenClaw Web Dashboard](./docs/images/home.png)

## 功能概览

当前已启用模块：

- 仪表盘：会话、Cron、技能、模型与 Usage 概览
- 在线对话：实时消息流、会话切换、`/new` `/skill` `/model` 命令补全
- 会话管理：会话筛选、列表浏览、详情跳转
- 记忆管理：Agent 文档目录、Markdown 阅读/编辑
- Cron 管理：任务列表、状态筛选、运行历史、执行内容查看
- Model 管理：Provider 配置、模型探测、默认模型设置
- 频道管理（中国版）：聚焦 QQ、飞书、钉钉、企业微信 4 个渠道，支持通过 WS 远程一键安装并生成配置、账号生命周期、策略配置、认证/配对、凭证掩码更新与高级 JSON 扩展字段编辑
- 技能管理：只展示用户创建/安装技能并支持更新
- 系统设置：网关地址与 Token 配置

当前保留但隐藏入口：

- Agent 监控（路由保留，侧边栏隐藏）
- 节点管理页面文件（未挂载路由）

## 技术栈

- Vue 3（Composition API + `<script setup>`）
- TypeScript（strict）
- Vite 7
- Pinia
- Vue Router 4
- Naive UI
- WebSocket RPC（对接 OpenClaw Gateway）

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env.development
```

按需修改 `.env.development`。

### 3. 启动开发环境

```bash
npm run dev
```

默认地址：`http://localhost:3000`

### 4. 生产构建

```bash
npm run build
npm run preview
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_WS_URL` | `ws://127.0.0.1:18789` | 默认 Gateway 地址 |
| `VITE_APP_TITLE` | `OpenClaw Web` | 页面标题（预留） |
| `VITE_APP_VERSION` | `0.1.0` | connect 握手客户端版本号 |

## 路由清单（当前生效）

- `/` 仪表盘
- `/chat` 在线对话
- `/sessions` 会话管理
- `/sessions/:key` 会话详情（隐藏入口）
- `/memory` 记忆管理
- `/cron` Cron 管理
- `/models` Model 管理
- `/channels` 频道管理
- `/skills` 技能管理
- `/settings` 系统设置
- `/login` 登录页

兼容跳转路由：

- `/config` -> `/models`
- `/tools` -> `/skills`

## 与 OpenClaw Gateway 对接

1. 登录页输入 Gateway WS 地址与 Token。
2. 应用通过统一 WebSocket RPC 客户端调用网关能力。
3. 模型页以网关配置为准（优先读取 `models.providers.*`）。

Token 获取示例：

```bash
openclaw config get gateway.auth.token
```

## 开发规范

- 提交前至少执行：

```bash
npm run build
```

- 若改动了页面交互，建议手测以下核心流程：
  - 登录 -> 进入仪表盘
  - 在线对话发送消息与 `/` 命令补全
  - 频道管理新增账号 -> 保存 -> 保存并应用 -> 认证/配对
  - Model 管理读取已配置渠道并保存
  - Cron 任务列表筛选、详情查看、立即运行
  - 记忆管理 Markdown 阅读与保存

## 项目结构

```text
src/
├── api/                # WebSocket 与 RPC 客户端
├── components/         # 通用组件与布局组件
├── composables/        # 可复用组合逻辑
├── layouts/            # 页面布局
├── router/             # 路由配置
├── stores/             # Pinia 状态
├── utils/              # 工具函数
└── views/              # 路由页面
```

## 参考链接

- [OpenClaw](https://github.com/openclaw/openclaw)
- [OpenClaw Docs](https://docs.openclaw.ai/)
- [Vue 3](https://vuejs.org/)
- [Naive UI](https://www.naiveui.com/)
