// 云函数 photoService —— PRD-031 照片私有存储
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const { ok, fail } = require('./common.js');

exports.main = async (event) => {
  try {
    const openid = cloud.getWXContext().OPENID;
    if (!openid) return fail('NOT_LOGIN');
    const { action, data } = event;

    if (action === 'signUpload') {
      const roomId = String((data && data.roomId) || 'room').replace(/[^a-zA-Z0-9_-]/g, '');
      const ext = String((data && data.ext) || 'jpg').replace(/[^a-zA-Z0-9]/g, '').slice(0, 5) || 'jpg';
      const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      // 路径含 openid，天然隔离；运营侧默认无法查看内容
      const cloudPath = 'photos/' + openid + '/' + roomId + '/' + stamp + '.' + ext;
      return ok({ cloudPath, uploadPath: cloudPath });
    }

    if (action === 'signRead') {
      const ids = (data && data.fileIds) || [];
      if (!ids.length) return ok({ urls: [] });
      // 仅允许读取本人路径下的文件
      const own = ids.filter(id => String(id).indexOf('photos/' + openid + '/') === 0);
      if (!own.length) return fail('PERMISSION_DENIED');
      const r = await cloud.getTempFileURL({ fileList: own });
      return ok({ urls: (r.fileList || []).map(x => x.tempFileURL).filter(Boolean) });
    }

    if (action === 'remove') {
      const ids = (data && data.fileIds) || [];
      const own = ids.filter(id => String(id).indexOf('photos/' + openid + '/') === 0);
      if (!own.length) return ok({ removed: 0 });
      const r = await cloud.deleteFile({ fileList: own });
      return ok({ removed: (r.fileList || []).length });
    }
    return fail('INVALID_ACTION');
  } catch (e) {
    return fail('STORAGE_FAILED', e.message || String(e));
  }
};
