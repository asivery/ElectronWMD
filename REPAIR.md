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
