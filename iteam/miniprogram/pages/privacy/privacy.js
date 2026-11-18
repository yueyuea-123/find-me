// pages/privacy/privacy.js —— 隐私与数据说明
Page({
  data: {},
  onLoad: function () {},
  openContract: function () {
    // 若已配置《用户隐私保护指引》，可用 open-type=openPrivacyContract 跳转；此处以文本说明为准
    wx.showModal({
      title: '用户隐私保护指引',
      content: '本小程序已在微信公众平台配置用户隐私保护指引，可在小程序详情中查看完整文本。平台规则以微信官方最新规范为准。',
      showCancel: false
    });
  }
});
