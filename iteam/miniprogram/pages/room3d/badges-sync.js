// pages/room3d/badges-sync.js —— BadgeSync 模块（阶段2c 首迁块，模块化路线 V1.0 阶段2b 七块划分）
// 职责：三维家具数量角标同步（R-17）：把 renderer.projectAll() 的屏幕投影结果
//       换算为角标列表（有物品且数量>0 的家具才显示），写回页面 data.furnitureBadges。
// 边界：只读写 furnitureBadges；渲染调用一律经页面 _withGL（保留整体降级语义），
//       不碰渲染锁、不碰选中态、不碰底部抽屉。迁移方式为 mixin 合并进 Page，this 语义不变。
module.exports = {
  _syncBadges: function () {
    if (!this._glRenderer || typeof this._glRenderer.projectAll !== 'function') return;
    var pts = this._withGL(function (gl) { return gl.projectAll(); }) || [];
    var self = this;
    var badges = [];
    pts.forEach(function (p) {
      var row = self._furniture && self._furniture[p.index];
      if (!row || !p.visible) return;
      // 只显示有物品的家具；数量为 0 不显示，避免画面杂乱
      if (!(row.bindCount > 0)) return;
      badges.push({ id: row.id, x: p.x, y: p.y, n: row.bindCount });
    });
    this.setData({ furnitureBadges: badges });
  }
};
