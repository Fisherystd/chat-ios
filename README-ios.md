# 人设聊天室 · iOS 独立 App 构建与安装指南（Windows + 免费 Apple ID）

本目录是「本机版」的 iOS 封装工程（Capacitor）。App 特点：

- **独立 App 图标**，打开后不经过浏览器（数据保存在 App 本地）
- **无登录/账号**、**不需要服务器**（不再使用阿里云服务器）
- 直接连接 DeepSeek API（需要联网，Key 填在 App 设置里）
- 人设、聊天、设置全部存在手机本地

> 重要限制（Apple 平台规则）：在 **Windows 上无法直接编译 iOS 安装包**，必须用 macOS 构建。这里的方案是：
> **用 GitHub 免费提供的 macOS 云构建机器** 生成 `.ipa`，然后在 Windows 上用 **Sideloadly** + 你的 **免费 Apple ID** 签名安装到 iPhone。
> 免费 Apple ID 签名的 App **每 7 天需要重新签名安装一次**（数据保留）；如果想长期有效，可购买 Apple Developer（$99/年）。

---

## 一、准备账号与工具

1. **GitHub 账号**（免费）：https://github.com — 用来跑免费 macOS 构建
2. **Sideloadly**（Windows 版）：https://sideloadly.io — 用来签名安装 App
3. **iPhone 数据线** + **Apple ID**（普通免费账号即可）
4. 电脑已装 Node.js（≥18，本项目开发机为 v24；若没有：https://nodejs.org 下载 LTS）

## 二、创建 GitHub 仓库并上传本目录

1. 在 GitHub 新建一个仓库（Repository），名字随意，例如 `persona-chat-ios`。
   - 想免费无限构建：选择 **Public**；想私有也可以（免费额度每月 2000 分钟，macOS 构建约消耗 10 倍，一般够用 2~3 次）。
2. 把**本目录（ios-app）里的全部文件**上传到仓库根目录：
   - 网页上传：仓库页面 → Add file → Upload files → 拖入本目录内容 → Commit
   - 或命令行（需已登录 GitHub）：
     ```
     cd ios-app
     git init
     git add .
     git commit -m "init"
     git branch -M main
     git remote add origin https://github.com/你的用户名/persona-chat-ios.git
     git push -u origin main
     ```

## 三、云端构建 .ipa

1. 打开 GitHub 仓库页面 → 顶部 **Actions** 标签
2. 左侧选择 **Build iOS IPA (unsigned)** → 右侧点 **Run workflow** → 再点绿色 **Run workflow**
3. 等待约 **10~20 分钟**（首次构建可能久一点）
4. 构建成功（绿色 ✓）后，点进这次运行 → 页面底部 **Artifacts** → 下载 **App-unsigned-ipa**（zip）
5. 解压得到 `App-unsigned.ipa`

> 如果构建失败：点进失败的步骤查看日志，把报错发我即可。

## 四、用 Sideloadly 安装到 iPhone（Windows）

1. 安装并打开 **Sideloadly**（Windows 版）
2. 用数据线连接 iPhone，iPhone 上点「信任此电脑」
3. 把 `App-unsigned.ipa` **拖入 Sideloadly 窗口**
4. **Apple ID** 处填写你的 Apple ID（用于签名，不会上传到我的服务器——本地签名）
5. 点 **Start**，按提示输入 Apple ID 密码（若提示双重认证，按提示在 iPhone 上确认）
6. 安装完成后，打开 iPhone：**设置 → 通用 → VPN 与设备管理 → 你的 Apple ID → 信任**
7. 回到主屏幕，点开「人设聊天室」App

> 若 Sideloadly 提示需要 App 专用密码：打开 https://appleid.apple.com → 登录 → 「App 专用密码」→ 生成一个 → 填到 Sideloadly。

## 五、App 内首次使用

1. 打开 App → 进入「设置」→ 填入你的 **DeepSeek API Key**（sk- 开头）→ 保存
2. 到「人设」新建或从文件导入人设（支持 txt/md 等）
3. 到「聊天」新建聊天 → 开始对话（支持聊天/故事/小说模式、推理强度等）
4. 从服务器版迁移：
   - 服务器版「人设 → 下载」导出人设 txt → 在 App「人设 → 从文件导入」
   - 或直接在 App 里重新粘贴人设内容

> 数据只存在本机 App 内。建议在「设置 → 数据备份」导出 JSON 备份（如已提供），或定期导出人设/聊天。

## 六、7 天续期与更新 App

- **免费 Apple ID 签名有效期 7 天**：到期后 App 打不开，重新用 Sideloadly **再安装一次同一个 ipa** 即可（覆盖安装，**数据保留**）。
- 想更新界面/功能：把新的 `www` 内容提交到 GitHub → Actions 重新构建 → 重新用 Sideloadly 安装。
- 想一劳永逸：购买 Apple Developer（$99/年）后可用自己的证书签名 1 年，也可用 TestFlight 安装。

## 七、常见问题

- **Actions 提示没有权限 / 按钮灰色**：仓库需要 GitHub 账号已登录，且 Actions 已启用（Settings → Actions → General → Allow all actions）
- **xcodebuild 失败**：检查日志；常见原因是 CocoaPods 依赖未同步（`npm run sync` 会在 CI 中自动执行）或签名参数（本项目已关闭签名，仅产出 unsigned ipa）
- **Sideloadly 报错 "Provision failed"**：换用 App 专用密码；确认 iPhone 已信任电脑；确认 Apple ID 未开启「需管理员批准」
- **App 打开白屏**：检查 www 内容是否完整（index.html 在仓库根 www/ 下），重新 `npx cap sync ios` 构建
- **服务器退订**：确认数据已导出备份后，可停止租用阿里云服务器；本 App 不依赖服务器
