// pages/history/history.js —— 移动历史 UI-014
var store = require('../../utils/store.js');
var C = require('../../utils/constants.js');

var ST = { at_home: '在家', unknown: '位置未知', out: '外出', borrowed: '借出' };
var CLS = { first_confirm: 'blue', move: 'green', out: 'orange', return: 'green', end: 'gray', initial: 'gray' };

Page({
  data: { title: '位置历史', history: [] },
  onLoad: function (q) { this._id = q.id || ''; },
  onShow: function () {
    var it = store.getItem(this._id);
    var list = store.listMovements(this._id).map(function (m) {
      function p(nodeId, status) {
        return nodeId ? store.nodePath(nodeId).join(' / ') : (ST[status] || status || '—');
      }
      return {
        id: m.id,
        typeText: C.MOVEMENT_TYPES[m.type] || m.type,
        cls: CLS[m.type] || '',
        fromText: p(m.fromNodeId, m.fromStatus),
        toText: p(m.toNodeId, m.toStatus),
        note: m.note || '',
        time: store.fmtTime(m.createdAt)
      };
    });
    this.setData({ title: (it ? it.name + ' · ' : '') + '位置历史（' + list.length + '）', history: list });
  }
});
