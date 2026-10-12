# DocShelf

本地文档分类索引与预览。把散在各处的文件**按原路径登记**进来，分好类、能搜、能直接打开——**不复制、不移动、不删除你的任何文件**。

Windows 桌面程序（Electron + 本地 Express），单机运行。

## 为什么这样设计

- **只登记，不搬运**：索引里记的是文件的原始绝对路径，`index.json` 只是一个清单。删除某条登记只删清单里的一行，磁盘上的文件原封不动。
- **平时不联网**：服务只监听 `127.0.0.1`，且校验请求来源。唯一的例外是「检查更新」——它只在用户自己点按钮时发一次请求。
- **无广告、不收费、不用注册**。

## 功能

- 拖拽或点「＋ 登记文件」把文件收进分类（任意盘符、任意目录都能登记）
- 大分类 / 子分类、搜索、标签、排序、列表与卡片两种视图、深色浅色主题
- 内置预览：PDF、Word、图片、TXT、Markdown、PPT
- 「📍 定位文件」在资源管理器里选中该文件；「打开所在文件夹」直达
- 工具箱：PDF 合并 / 分割 / 旋转 / 提取页 / 删除页 / 重排、图片转 PDF、PDF 转图片、图片互转，以及 Word ↔ PDF（借助本机安装的 Microsoft Word）

## 下载与安装

到 [Releases](https://github.com/Alone-1024/DocShelf/releases) 下载：

- `DocShelf-Setup-<版本>.exe` —— 安装版（推荐）。装一次，之后直接双击新版安装包装上即可，**覆盖安装不会丢登记记录**。
- `DocShelf.exe` —— 免安装版，单文件放哪都能跑，登记数据存在 exe 同目录的 `index.json`。

程序未做代码签名，首次运行 Windows 可能弹 SmartScreen 提示，点「更多信息 → 仍要运行」即可。

## 你的数据存在哪

| 形态 | 数据位置 |
| --- | --- |
| 安装版 | `%APPDATA%\DocShelf\index.json` |
| 免安装版 | exe 同目录的 `index.json` |
| 源码运行 | 项目目录下的 `index.json` |

`index.json` 里只有路径、分类名和你写的备注，不含文件内容。保存采用「临时文件 + 改名替换」并保留上一份 `index.json.bak`，不会因为一次写坏而丢全部记录。

## 从源码运行

```bash
npm install
npm start          # 只起本地服务，浏览器打开 http://127.0.0.1:3210
npm run app        # 起 Electron 窗口（推荐，能登记任意位置的文件）
```

打包（Windows，产出安装版 + 免安装版两个包）：

```bash
npm run dist
```

## 许可

Copyright © 2026 Alone-1024

本项目基于 **Apache License 2.0** 开源，全文见 [LICENSE](LICENSE)。

随程序分发的第三方组件各自遵循其原始许可，主要包括：Electron（MIT）、Express（MIT）、pdf-lib（MIT）、pdfjs-dist（Apache-2.0）。这些组件的许可原文随 `node_modules` 一起打包在程序内。

## 反馈

写信到 [1350483764@qq.com](mailto:1350483764@qq.com)。程序里左下角「?」→「✉️ 发给作者」会自动带上排查需要的信息。
