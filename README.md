# EM-Track 网页演示 · GitHub Pages

在线演示：[打开 EM-Track demo](https://haitoooo.github.io/emtrack-demo/)。

浅色的本地端／服务器端双栏：左侧上下播放当前场景的原始画面与跟踪画面，右侧展示加密画面、简洁的处理流程和实际返回的目标 ID。八段场景默认依次播放，总源时长 107 秒；每次只展示一路。

支持播放／暂停、拖动进度、上一段／下一段、直接选择场景、倍速、自动切换、画面放大和手机布局。页面不展示特征图、匹配分数、参数或 JSON。原始视频和加密视频保持同步，跟踪框与轨迹由已经记录的 HTTP 结果绘制。

```bash
cd web_demo
node scripts/serve.mjs
```

打开服务器打印的地址。远程开发时可转发 4173 端口。网页位于 `dist/`，无运行时框架或外部资源依赖，也可放到任意支持静态文件的网站服务中；`npm run dev` 与上面的启动方式相同。

部署使用 GitHub Pages，配置在 `.github/workflows/pages.yml`。把本目录作为独立仓库的根目录上传到 `main`，然后在仓库 **Settings → Pages → Build and deployment → Source** 中选择 **GitHub Actions**，运行 **Actions → Deploy demo to GitHub Pages → Run workflow**。首次部署完成后，Pages 设置页和工作流中的 `github-pages` 环境会显示实际网址；之后 `main` 上的网页或工作流更新会自动发布。无需安装前端依赖或设置额外密钥；工作流只上传 `dist/`。

工作流依据 [GitHub Pages 官方说明](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)配置。

若放入现有项目仓库，仍应让此工作流位于仓库根目录的 `.github/workflows/`，并把 `path: dist` 和 `paths` 改为该仓库中网页的实际相对路径，`branches` 改为仓库的默认分支。

网页全部使用相对路径，支持 GitHub Pages 的仓库子路径。可在本地按同样的目录结构检查：

```bash
BASE_PATH=/emtrack-demo node scripts/serve.mjs
# 在另一个终端运行现有浏览器检查。
DEMO_TEST_URL=http://127.0.0.1:4173/emtrack-demo/ npm test
```

```bash
# 在原项目内，核对浏览器素材与实际 HTTP 结果。
python scripts/check_media.py

# 有 Playwright 浏览器时，检查交互与响应式布局。
npm test

# 原始记录更新时重新准备网页素材，不会重新训练或推理。
python scripts/prepare_media.py --recordings ../runs/demo_eight_20261024
```

`dist/catalog.json` 定义八段的顺序。每段的 `original.mp4` 是原始 H.264 的浏览器容器封装，`encrypted.mp4` 来自实际选择性加密码流的本地可视化，`tracks.json` 保留真实回传的 ID 和框。页面是已录制结果的交互回放，没有把浏览器端展示称作现场服务器实时推理。项目不包含端侧密钥、模型权重或 GT。
