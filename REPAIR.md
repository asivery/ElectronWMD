# ElectronWMD 退出崩溃修复交付

## 结论与边界

已实现退出清理修复，并生成独立的 macOS arm64 测试应用；尚未完成实体 MiniDisc 设备验收。
用户选择先完成软件测试与测试包，因此本次没有连接设备、读盘或写入用户磁盘。

2026-09-20 13:37:06 的原始崩溃发生在退出过程中，调用链为
`Node 环境销毁 → Device 析构 → libusb_close → pthread_mutex_lock 断言 → SIGABRT`。
应用原先没有统一的异步退出清理，NetMD 重置失败还会跳过关闭。
销毁顺序冲突是与证据一致的根因推断；没有实体设备复现，不能把此次软件测试当成原故障已经消失的证明。

## 修复内容

- 窗口关闭、菜单退出、内部重启共用一次清理流程；暂停新设备请求，等待已经进入主进程的设备操作与本地编码完成。
- 保留取消下载、坏扇区处理回调等控制消息，让已有操作可以收尾；不会以 10 秒超时为理由强杀写入。超过 10 秒显示等待标题和进度状态。
- 完成 NetMD 上传会话／恢复下载状态、HiMD 刷盘与签名、Network Walkman 会话与数据库提交后，再停止端点轮询、释放接口并关闭句柄。
- 修复 NetMD 重置失败后跳过关闭；收集部分初始化过程中已经打开的原生设备作为兜底。
- 非 DRM Walkman 虽然没有签名会话，也会在退出时提交上传产生的数据库更新。
- 清理失败保留窗口和设备状态，提供重试；已完成的清理阶段不重复执行。
- macOS 辅助进程增加关闭请求／确认协议；主进程等待确认与连接关闭，断开不会在退出期间触发重启。辅助进程处理 SIGTERM 和连接断开时也先清理设备。
- 测试包采用独立应用名称、bundle ID、用户目录和辅助进程 socket 目录，保留原安装包及配置。

内部新增 `shutdown(): Promise<void>`；服务原有 IPC 的 `[result, error]` 返回结构保留。
辅助进程新增 `{service: '__lifecycle', name: 'shutdown', allArgs: []}`，成功返回后关闭连接。
原版辅助进程与测试包的辅助进程不混用。

主进程日志写入应用用户目录的 `logs/shutdown-main.log`；辅助进程写入其工作目录下的
`ewmd-<uid>/shutdown-helper.log`。日志包含退出来源、在途请求数及清理阶段，单文件超过 1 MiB 轮换。

## 固定版本与构建

- 主仓库：官方标签 `v0.5.2-1.5.3`，提交 `d2a9c8e565533a03246754908eff89f5eddcfdcf`。
- 子模块：`3287ec25d771046c5fa232fecbfc26900fa3c64f`。
- 分支：`codex/fix-usb-shutdown`。
- 原有依赖锁保持不变，USB 仍为 `2.13.0`；原 macOS WebUSB 补丁已固定在 `patches/`。
- 测试包运行时单独固定为 **Electron 43.3.0**，随附 Node 24.18.1；构建与测试使用 Node 24.19.0。

运行时调整的实际原因：本机 macOS 27.0（26A428）在 13:52 启动原始 Electron 31.7.7
开发运行时时报告撤销 hash 和 `evaluateScanResult: 2`，并将新下载的开发运行时移入废纸篓。
未关闭系统防护，未修改原安装包。测试包因此使用
[官方 Electron 43.3.0](https://github.com/electron/electron/releases/tag/v43.3.0)，并补齐新版 Chromium
要求的自定义资源协议 CORS 声明。运行时升级仅用于独立测试构建，不能单独作为 USB 故障已修复的依据。

在 Node 24.19.0 环境中执行：

```sh
git submodule update --init --recursive
npm ci --no-audit --no-fund
npm run test:shutdown
npm run pack:shutdown-test
npm run install:test-runtime
npm run test:smoke
npm run test:packaged
```

`test:shutdown` 默认使用当前 Node 运行辅助进程集成测试。若要使用实际 Electron 运行时：

```sh
EWMD_TEST_ELECTRON="$PWD/build/electron-43.3.0/Electron.app/Contents/MacOS/Electron" npm run test:shutdown
```

`build-renderer.sh` 使用子模块锁文件安装依赖；已有 `renderer` 时复用该目录。
更换子模块版本后，先将旧 `renderer` 移出工作目录再构建。原有 `npm start` 仍指向
锁文件中的 Electron 31，当前这台机器应使用以上测试构建流程。

## 验证记录

- TypeScript 编译与前端生产构建通过。
- 17 项自动测试：在途写入等待、新请求拒绝、重复退出、失败重试、超时提示、重置失败、断开接口、部分初始化句柄、服务会话顺序、非 DRM 提交、重启顺序及真实辅助进程关闭协议。
- 已有 socket 路径检查通过。
- Electron 43.3.0 下完成 20 次无设备界面启动／退出循环（窗口关闭与应用退出各 10 次），以及一次真实重启。每次检查界面实际渲染、进程正常退出与清理完成日志。
- 最终 arm64 应用包检查：界面渲染、独立用户路径、正常退出、本地临时签名及完整性验证。
- 未发现新的 ElectronWMD 崩溃报告或测试辅助进程残留。

原始测试日志及 JSON 结果在 `build/verification/`；界面截图为 `packaged-ui.png`。
20 次循环针对无设备场景；它们不等同于原计划中的 20 次实体设备连接／退出测试。

仍需实体设备验收：连接后退出、读盘后退出、设备拔除、内部重启、20 次连接／退出循环，
以及使用可改写测试盘验证写入中退出。若仍触发同一原生断言，应据新增日志继续检查
libusb 上下文销毁顺序，不把清空缓存或强制退出作为修复。

## 使用与回退

测试应用位于 `build/shutdown-test/mac-arm64/ElectronWMD Shutdown Test.app`，可直接打开，
无需覆盖 `/Applications/electronwmd.app`。它使用本地临时签名，未进行 Apple 公证。
测试包不会自动迁移旧配置或密钥；需要的设置可在测试应用内重新配置。

回退时退出测试应用并重新打开原安装版本即可。当前没有执行正式替换、发布或提交远程 PR。
源码差异同时导出到 `build/ElectronWMD-shutdown.patch`，应用压缩包及校验值位于 `build/`。

## 2026-09-23：录歌停在转换 0%

现场控制台报错：`Failed to execute 'importScripts' on 'WorkerGlobalScope':
The script at 'sandbox://worker.min.js/' failed to load.`
当时只有 `prepareUpload` 完成，没有开始传输歌曲。

根因：旧版 renderer 把根目录资源写成 `sandbox://worker.min.js`，标准协议 URL
会自动补成 `sandbox://worker.min.js/`。主进程将末尾斜杠保留到本地文件路径，
导致系统把 JS 文件按目录打开并失败。修复在本地路径解析时移除末尾分隔符，
同时覆盖 `ffmpeg-core.js`，无需更改歌曲、编码设置或 USB 驱动。

新增 `scripts/smoke-conversion.cjs`，在独立用户目录运行真实 Electron/FFmpeg，
用生成的 1 秒立体声音频验证 worker 启动、两次 PCM 转换的逐样本一致性，以及
MP3 转换。修复前复现同一加载错误，修复后每次 PCM 输出 176400 字节，
MP3 输出 17180 字节。测试不连接实体设备。

```sh
npm run build:main
build/electron-43.3.0/Electron.app/Contents/MacOS/Electron scripts/smoke-conversion.cjs
```

本次更新了 `/Applications/ElectronWMD.app` 的 `dist/main.js` 及 source map，
保留其他组件和用户设置，并重新完成本地临时签名。原安装包备份在
`build/backups/ElectronWMD-before-conversion-fix.app`。
转换验证日志见 `build/verification/conversion-{before,after,installed}.log`。
实体 MD 的最终写入仍需用户重试确认。

## 2026-09-23：Hi-MD 改用系统管理员授权框

macOS 的 Hi-MD / Network Walkman 连接改用 AppleScript 的
`do shell script ... with administrator privileges`，不再启动 Terminal 或执行交互式 sudo。
密码由系统接收。辅助进程使用后台模式，显式传递 Electron Node 模式、工作目录及原用户 UID/GID，
标准输入关闭，输出写入 `/tmp/ewmd-helper.XXXXXX/helper.log`。
日志目录由提权进程创建，打开日志文件后将目录和日志交给当前用户，权限分别为 0700 和 0600；
启动超时会把日志末尾最多 8 KiB 和日志路径附在错误中。

同一服务同时发起的连接请求合并；重连和设备 RPC 串行执行。
授权成功后等待 Socket 最多 30 秒，取消授权后可重试，失败原因保留至后续配对错误显示。
退出 WMD 会先取消授权等待，再等待已提交的设备操作并执行原有刷盘和关闭流程。
辅助进程 30 秒没有客户端连接时走正常清理流程退出，不强杀设备写入。

验证：24 项自动测试通过，辅助进程集成测试使用 Electron 43.3.0；最后的错误传递修改也通过
相关 9 项回归。实际编译了授权 AppleScript，验证中文、空格、单双引号、反斜杠及换行路径的
AppleScript/Shell 往返与日志权限。独立 arm64 打包应用通过临时签名校验、界面启动和正常退出；
真实 Electron IPC 中模拟取消授权，验证重复连接只启动一次、后续配对保留错误且能够重试。
这些测试未输入真实管理员密码，也未连接实体 Hi-MD。

测试应用：`build/authorization-test/mac-arm64/ElectronWMD Shutdown Test.app`。
本次未替换 `/Applications` 中的应用。构建后可复现打包回归：

```sh
EWMD_PACKAGED_EXECUTABLE="$PWD/build/authorization-test/mac-arm64/ElectronWMD Shutdown Test.app/Contents/MacOS/ElectronWMD Shutdown Test" EWMD_SMOKE_AUTHORIZATION=1 node scripts/smoke-packaged.cjs
```

### 同日修正：授权后等待 30 秒超时

用户提供的 `/tmp/ewmd-helper.qIhJYb/helper.log` 经系统授权读取后显示：
`nohup: can't detach from console: No such process`。
这是原后台命令在无控制终端的管理员环境中退出，设备服务尚未启动；并非密码错误。

删除 `/usr/bin/nohup`，改为后台子 shell 中 `trap '' HUP` 后 `exec` 设备服务，
继续关闭标准输入并重定向输出。根权限下先打开日志文件描述符，再把目录和文件交给当前用户，
避免再次为读取启动错误请求管理员密码。

7 项启动测试通过；通过真实系统密码框完成提权集成测试，验证辅助进程 PID 文件属主为 root、
Socket 属主为当前用户、日志可读取且权限为 0600，连接后正常关闭并移除 Socket/PID。
成功日志：`/tmp/ewmd-helper.modRrE/helper.log`。该验证没有执行实体设备配对、读盘或写盘。

修正版应用位于 `build/authorization-fixed/mac-arm64/ElectronWMD Shutdown Test.app`，
保留先前运行中的测试应用及 `/Applications` 安装版本。修正版完成本地签名校验和打包界面回归。
打开修正版时请先退出旧测试应用。实体 Hi-MD 的读盘和写盘仍需实机验收。
