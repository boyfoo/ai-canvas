# 后端与宿主合同

本工程只包含前端。基础画布默认在浏览器中独立运行，画布、素材和模型配置保存在本地，无需实现本文接口。模型目录和底层模型传输直接请求服务商，不使用工作区后端中转。

本文记录保留的可选工具与尚未改造的业务服务接口。原生桥接已经移除，这些服务功能通过 HTTP 或宿主注入的异步方法接入。原生成任务队列和助手执行尚未全部改为浏览器直连；不要将测试接口数据用于生产执行。

## 已有业务 API

`src/services/api/request.ts` 统一解包 `{ code: 0, data, msg }`。失败继续抛出 `ApiError`，取消保留 `AbortError`。使用 Cookie 会话与 `credentials: include`，不再注入桌面启动 Token，也不修改全局 `fetch`。

主要依赖包括：

| 功能 | API 家族 | 必须保留的语义 |
| --- | --- | --- |
| 工作区与模型配置 | 浏览器 IndexedDB | 单工作区身份由前端建立，模型配置和密钥只保存在当前浏览器 |
| 画布 | `/canvas-projects/*`、画布文件夹与操作合同 | 版本确认、冲突检测、操作日志、回收站、可重试保存 |
| 媒体与素材 | `/resources/*`、`/assets/*` 等 | 原始媒体、Blob、播放代理、资源引用及上传取消 |
| 生成 | `/tasks/*`、`/ai/*`、自定义渠道中转 | 任务状态、取消、重试、协议差异和资源结果 |
| 文本事件 | `/tasks/:id/text-events` | SSE 游标递增、断线恢复、取消、正确响应类型 |
| 助手与技能 | `/assistant/*`、技能与市场相关接口 | 官方宿主执行、授权、流式响应和持久会话；前端没有另建模型循环 |
| 工作流与项目 | 工作流、项目、章节、分镜、剪辑与导出相关接口 | 实际参数、资源归属和写入确认 |
| 工具服务 | Eagle、转换、转写、深度任务与诊断相关接口 | 服务可用性、任务进度与真实错误 |

`api-call-inventory.json` 列出当前源码中的 HTTP、fetch 与 EventSource 调用位置。它是静态阅读地图，含动态表达式和非业务 fetch，不能代替完整服务端规范。`upstream-openapi.yaml` 是固定提交的上游参考快照；以实际客户端与服务端实现对照接入。

## 本次新增的宿主适配合同

下列 URL 都相对 `apiBaseURL`。原 Go 服务的桌面方法没有自动变成 HTTP 接口，后端需要实现这些合同，或者由宿主注入等效方法。

| HTTP | URL | 前端宿主方法 | 响应 data |
| --- | --- | --- | --- |
| GET | `/canvas-host/reference-storage` | `getReferenceStorage` | `ReferenceStorageConfig` |
| PUT | `/canvas-host/reference-storage` | `saveReferenceStorage` | 保存后的脱敏配置 |
| POST | `/canvas-host/reference-storage/test` | `testReferenceStorage` | 测试成功后返回空数据 |
| POST | `/canvas-host/reference-uploads` | `uploadReferenceMedia` | `{ [resourceId]: httpsURL }` |
| GET | `/canvas-host/reference-uploads/progress` | `getReferenceUploadProgress` | 上传阶段与字节进度；注入宿主时可省略此方法 |
| GET | `/canvas-host/depth/status` | `getDepthStatus` | `{ status: "ready" 或 "unavailable", engine?, detail? }` |

PUT 请求体是配置加 `secretAccessKey`，响应只返回 `hasSecret`，不返回密钥。上传请求体为 `{ resourceIds: string[] }`，资源必须属于当前工作区；服务负责确认公网链接可用。前端保留去重、串行队列、进度和 AbortSignal，禁止将不安全链接当作有效结果。

深度状态只有真实就绪时才允许提交。浏览器不负责下载模型、安装 Python 或管理服务器磁盘目录。深度任务本身仍走已有生成／处理客户端，`ready` 只代表预检通过。

对象存储上传可以很长，默认 HTTP 适配没有总时长限制，仍接受取消信号。服务端也应响应取消并清理未完成工作。进度接口以单工作区当前上传为范围；多客户端并发部署应注入带操作 ID 的宿主适配，保证进度对应实际任务。

## 宿主注入

在 `src/main.tsx` 执行前设置，例如由自己的入口模块先配置再动态导入：

```ts
import type { CanvasHostServices } from "./src/services/canvas-host";

window.__CANVAS_CONFIG__ = {
    apiBaseURL: "/api",
    resourceStorage: "service",
};

const services: Partial<CanvasHostServices> = {
    // 在这里实现自己已有的参考存储、上传和深度状态接口。
    // 每个方法必须返回真实结果并传递 options.signal，不要返回固定成功。
};
window.__CANVAS_SERVICES__ = services;
await import("./src/main");
```

没有覆盖的方法使用上表的默认 HTTP 适配。宿主服务在首次读取时固定，配置须在启动前完成。

## 存储与部署

- 默认 `resourceStorage: "browser"`：媒体在 IndexedDB，基础画布无需服务端。工具服务不能直接读取浏览器 Blob，需要服务处理的输入仍必须上传成资源。
- 可选 `service`：媒体由资源 API 持久化，服务端生成和助手能够引用资源 ID；IndexedDB 用于缓存和草稿。
- “本地工作区”继续使用上游单工作区合同，不是按协议或地址猜测桌面模式。
- 推荐同源 API。跨域服务必须正确配置 Cookie、CORS、媒体和 SSE；前端不会把 API Token 拼入 URL。
- 生产前端路由需要 SPA fallback，但 `/api` 不得回退成 HTML。文本 SSE 需要关闭该路径的代理缓冲；不要对全部 API 统一配置长超时。
- 未提供工具服务时，基础画布正常启动；工具功能显示未配置服务，不能把本地保存标记成服务端已保存。
- 原画布中的可选 Framefield 本地运行时客户端继续保留，单独由 `VITE_FRAMEFIELD_LOCAL_RUNTIME_ENDPOINT` 配置，默认 `http://127.0.0.1:17371`。它是独立服务协议，并非被移除的 Wails 桥；需要该能力时仍须部署对应服务。
