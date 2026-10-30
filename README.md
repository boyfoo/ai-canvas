[中文](README.md) · [English](README.en.md)

# Canvas

从 BeefTV 提取的独立画布前端工程，基于 React 19、TypeScript、Vite、Ant Design 和 Zustand。保留原画布渲染与交互实现，适合在此基础上继续开发。

上游固定为 `glanderness/BeefTV` 的 `b3b6e2e380cb13cead3b7eb0d9c479a0f7125fad`。许可与版权信息保留在 `LICENSE`、`NOTICE` 和 `THIRD_PARTY_NOTICES.md`。

## 保留范围

画布、全部内置节点、连线、分组、快捷键、撤销重做、导入导出、素材工具、生成参数、模型渠道、助手与技能、工作流、分镜、导演工作台、时间线、字幕、转写、媒体转换和它们的资源均保留。画布链接使用的素材、技能、扩展与项目画风等支持页面继续提供路由。

移出了桌面更新、Wails 绑定、系统目录迁移、全站产品侧栏与搜索、独立首页／创作／Agents／实验页面。没有复制 Go 后端、Node 助手宿主或 Python 处理工具。

## 运行

需要 Bun 1.3.11 或更新的兼容版本。**基础画布无需后端即可运行**：项目、节点、连线和素材保存在当前浏览器的 IndexedDB，支持编辑、刷新恢复与导入导出。

```sh
bun install --frozen-lockfile
bun run dev
```

默认地址为 `http://127.0.0.1:3000/canvas`。开发时启动的是 Vite 静态资源服务；最终构建产物是 `dist/` 静态文件，部署时让前端路由回退到 `index.html` 即可。基础画布不需要配置 `/api` 代理。

模型渠道和密钥保存在当前浏览器的本地存储中，模型目录和底层模型传输直接请求配置的服务商地址，不经过工作区后端。服务商必须支持浏览器 CORS。原来的生成任务队列、助手宿主、插件运行及深度处理仍依赖服务接口，尚未全部改成浏览器执行；基础画布启动与保存不会等待这些服务。

可在「模型设置」的连接卡片或新增连接窗口点击「测试直连」。火山方舟默认用 GET 读取视频任务列表，不创建生成任务；也可更换同一服务下的请求地址、方法和 JSON 请求体。测试会显示可读取的 HTTP 状态和响应摘要；浏览器无法读取响应时，需结合 Console / Network 区分 CORS、网络和 TLS 问题。POST 会真实调用指定接口，生成请求可能产生费用。一次测试只代表该地址和方法，不能证明全部生成接口可用。

新增一级服务商「火山方舟(视频版)」，与 OpenAI、Google Gemini、原「火山方舟」并列。选择后填写 API Key，勾选预置 Seedance 视频模型，或填写 Model ID / Endpoint ID 并明确选择模型系列。预置列表不是账号权限查询；新提供商不请求 `/models`。视频创建、查询、取消及画布结果保存由浏览器执行，不需要业务后端中转。其他服务商的完整生成链路仍按原实现执行。

在模型的「高级模型设置与测试 → 编辑模型使用配置 → 基本信息 → 参考素材传输」中，可以分别选择图片、视频、音频的传输方式：火山方舟 Files API、已有对象存储、手动 HTTPS 链接或直接传入。默认图片和音频直接传入，本地视频上传 Files API。Files 地址由当前服务地址拼接 `/files`，使用该连接的 API Key；它是可选云端存储方式，原对象存储配置继续独立使用。原对象存储仍需配置对应宿主服务，未配置时可使用现有链接填写流程。上传 Files 后查询真实 `download_url` 再提交视频任务，不把 File ID 当作 asset ID。Files 临时文件和链接会过期，原素材及成功取回的生成视频保留在浏览器 IndexedDB。

任务记录使用 `app_state` 中 `infinite-canvas:provider-tasks:user:<scope>:browser-task-*` 保存，不保存每任务密钥；刷新后按上游任务 ID 继续查询。提交结果不确定时不会自动重发，可在任务详情关联方舟控制台中的原任务 ID。关闭页面会暂停浏览器轮询，恢复页面后继续观察。生成及文件上传分别受服务商 CORS、账号权限和计费规则约束。

请求参数依据[视频生成 API](https://console.volcengine.com/ark/region:cn-beijing/docs/create-video-generation-task-api)、[上传文件](https://docs.volcengine.com/docs/ark/upload-files-api?lang=zh)及[文件详情](https://docs.volcengine.com/docs/ark/search-files-api?lang=zh)实现。Seedance 2.5 支持在模型高级参数中设置样片、返回尾帧、输出格式及样片转正式；其余通用视频参数继续在画布调整。

浏览器可选择和拖入本地文件、下载导出文件，并执行已有的浏览器媒体处理；运行 Python、本机命令及不受限制的磁盘目录操作需要另行接入本地工具服务。静态站点地址（协议、主机、端口）不同会使用不同的浏览器存储，迁移站点时应先导出项目。

```sh
bun run typecheck
bun run test
bun run build
bun run start
```

浏览器冒烟需要 Node.js 20+ 和已安装的 Google Chrome：先构建，再运行 `bun run test:browser`。测试仅提供静态构建文件，验证无后端启动、新建、节点改名与拖动、素材保存、刷新恢复、ZIP 导出，以及独立 CORS 模型服务的直连与配置保存；不调用真实模型。

构建默认包含全部高级媒体资源，无精简构建开关。`bun run start` 预览静态产物。只有使用可选工具服务时才需要 `VITE_CANVAS_BACKEND_URL`，开发代理地址用 `VITE_API_PROXY_TARGET` 配置（支持 `.env.local`）。

锁文件保留上游依赖版本与完整性校验值，将镜像下载地址归一到 npm 官方源；Vidstack 补丁继续通过 Bun 应用。

## 二次开发入口

- `src/pages/canvas`：画布页面、交互与生成流程。
- `src/components/canvas`、`src/lib/canvas`、`src/stores/canvas`：组件、算法与状态。
- `src/router.tsx`、`src/layouts/canvas-layout.tsx`：独立入口及支持页面。
- `src/services/api`：现有业务 HTTP、资源和事件流客户端。
- `src/services/canvas-host.ts`：原生桥接改造后的宿主服务合同。
- `src/lib/canvas-host-config.ts`：API 地址与资源存储策略。
- `docs/extraction-manifest.json`：移出文件记录。

宿主可以在 `main.tsx` 执行前注入 `window.__CANVAS_CONFIG__` 与 `window.__CANVAS_SERVICES__`，也可以直接实现默认 HTTP 合同。对象存储设置、参考素材上传和深度状态这 **6 个 `/api/canvas-host/*` 接口是本次定义的适配合同，上游 Go 服务并未自动新增这些接口**。接入方法见 [后端与宿主合同](docs/backend-contract.md)。

“本地工作区”表示浏览器内的单工作区，不等于桌面运行环境。默认使用浏览器素材存储；需要接入资源服务时，可通过显式资源存储配置切换。

测试和验证范围见 [抽离说明](docs/extraction.md)。
