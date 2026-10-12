// 只干一件事：把拖进来/选出来的文件在磁盘上的真实位置告诉页面。
// 页面拿到绝对路径才能「只登记原文件、不复制一份」。除了这个不暴露任何能力。
const { contextBridge, webUtils } = require('electron');

contextBridge.exposeInMainWorld('DocShelfNative', {
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return ''; }
  },
});
