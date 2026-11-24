# 图片文字提取

纯静态网页：选择图片或拍照，提取图片中的文字与表格。无需构建、无需后端即可部署。

## 功能

- 选择图片（支持多选、拖拽）或调用摄像头拍照
- 浏览器本地 OCR（Tesseract.js），首次使用需联网下载语言包
- 文字识别 + 表格近似还原
- 可选云端增强：接入 OpenAI 兼容的视觉模型，返回结构化表格
- 多图排队串行识别，带进度
- 复制结果、导出 `.txt` / `.md` / 表格 `.csv`
- 识别历史（保存在浏览器本地，最多 20 条）
- 识别语言切换：中文简/繁、英文、日文、韩文
- 响应式布局，支持手机使用

## 目录结构

```
index.html          页面结构
styles.css          样式（含深色模式）
js/config.js        设置读写（localStorage）
js/i18n.js          OCR 语言列表
js/image.js         图片读取、压缩、缩略图、摄像头取帧
js/table.js         词框聚类还原表格、Markdown/CSV 转换
js/ocr-local.js     Tesseract.js 本地识别
js/ocr-cloud.js     OpenAI 兼容接口调用与结果解析
js/history.js       识别历史
js/app.js           界面交互与状态管理
```

## 本地预览

在项目目录启动任意静态服务器：

```bash
python3 -m http.server 8080
```

打开 <http://localhost:8080>。

> 直接双击 `index.html` 也能打开，但部分浏览器在 `file://` 下会限制 Worker 和摄像头，建议用静态服务器。

## 部署

### Netlify Drop（最快，无需注册）

1. 打开 <https://app.netlify.com/drop>
2. 把仓库里的 `image-ocr-web.zip` 拖进页面（或拖解压后的文件夹）
3. 几秒后得到一个 `https://xxx.netlify.app` 网址

站点生成后可注册账号认领，以便保留和绑定自定义域名。

### 静态托管

`index.html`、`styles.css`、`js/` 是全部产物，直接上传到 GitHub Pages、对象存储或任意静态托管即可，不需要 npm 和构建步骤。

Tesseract.js 通过 CDN 加载，页面运行环境需要能访问 `cdn.jsdelivr.net`。

### 关于华为云 OBS

本站曾尝试部署到华为云 OBS 静态网站托管，但该桶对 HTML 对象强制返回 `Content-Disposition: attachment`（上传时写 `inline`、预签名覆盖响应头均无效），浏览器会直接下载首页而不是渲染，因此不建议使用 OBS 托管本页面。

## 云端增强配置

默认使用本地识别。点击右上角「设置」开启云端增强，填写：

| 字段 | 说明 |
| --- | --- |
| 接口地址 | OpenAI 兼容接口的 Base URL，页面会请求 `{Base URL}/chat/completions` |
| API Key | 你的密钥，仅保存在当前浏览器的 localStorage |
| 模型名称 | 支持图片输入的视觉模型，例如 `google/gemini-2.0-flash-001` |

### 为什么默认推荐 OpenRouter

页面是纯静态的，浏览器直接请求第三方接口会被跨域（CORS）拦截。OpenRouter 允许浏览器端调用，适合直接填 Key 使用：

```
接口地址：https://openrouter.ai/api/v1
模型名称：按 OpenRouter 模型页填写支持图片的模型
```

其他服务商（OpenAI、通义、豆包等）通常不允许浏览器直连，需要自建一个代理，把「接口地址」指向代理。

### 自建代理示例（Cloudflare Worker）

```js
export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: cors });
    }
    const path = new URL(request.url).pathname;
    const upstream = await fetch(env.UPSTREAM_BASE.replace(/\/+$/, "") + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + env.API_KEY
      },
      body: await request.text()
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
};
```

配置环境变量 `UPSTREAM_BASE=https://api.openai.com/v1`（换成你的服务商地址）和 `API_KEY`，然后把 Worker 域名填入「接口地址」。

## 隐私说明

- 本地识别：图片只在浏览器内处理，不上传。
- 云端增强：图片会以 Base64 发送到你配置的接口。
- API Key 仅存在浏览器 localStorage，不会上传；但纯静态页面的 Key 对能访问该浏览器的人可见，请使用有额度限制的 Key。

## 已知限制

- 本地表格是按文字坐标聚类做的近似还原，复杂合并单元格效果有限；需要精确表格请用云端增强。
- 首次识别会下载语言包（中文约 10–15MB），之后走浏览器缓存。
- 超大图片会被压缩到最长边 1800px 后再识别。