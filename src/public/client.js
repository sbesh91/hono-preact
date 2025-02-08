var Q, h, We, j, Ee, Be, ue, ze, me, fe, pe, Ye, X = {}, qe = [], ft = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i, re = Array.isArray;
function N(e, t) {
  for (var n in t) e[n] = t[n];
  return e;
}
function ge(e) {
  e && e.parentNode && e.parentNode.removeChild(e);
}
function F(e, t, n) {
  var o, _, r, c = {};
  for (r in t) r == "key" ? o = t[r] : r == "ref" ? _ = t[r] : c[r] = t[r];
  if (arguments.length > 2 && (c.children = arguments.length > 3 ? Q.call(arguments, 2) : n), typeof e == "function" && e.defaultProps != null) for (r in e.defaultProps) c[r] === void 0 && (c[r] = e.defaultProps[r]);
  return G(e, c, o, _, null);
}
function G(e, t, n, o, _) {
  var r = { type: e, props: t, key: n, ref: o, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: _ ?? ++We, __i: -1, __u: 0 };
  return _ == null && h.vnode != null && h.vnode(r), r;
}
function W(e) {
  return e.children;
}
function I(e, t) {
  this.props = e, this.context = t;
}
function Y(e, t) {
  if (t == null) return e.__ ? Y(e.__, e.__i + 1) : null;
  for (var n; t < e.__k.length; t++) if ((n = e.__k[t]) != null && n.__e != null) return n.__e;
  return typeof e.type == "function" ? Y(e) : null;
}
function Je(e) {
  var t, n;
  if ((e = e.__) != null && e.__c != null) {
    for (e.__e = e.__c.base = null, t = 0; t < e.__k.length; t++) if ((n = e.__k[t]) != null && n.__e != null) {
      e.__e = e.__c.base = n.__e;
      break;
    }
    return Je(e);
  }
}
function he(e) {
  (!e.__d && (e.__d = !0) && j.push(e) && !oe.__r++ || Ee !== h.debounceRendering) && ((Ee = h.debounceRendering) || Be)(oe);
}
function oe() {
  var e, t, n, o, _, r, c, l;
  for (j.sort(ue); e = j.shift(); ) e.__d && (t = j.length, o = void 0, r = (_ = (n = e).__v).__e, c = [], l = [], n.__P && ((o = N({}, _)).__v = _.__v + 1, h.vnode && h.vnode(o), be(n.__P, o, _, n.__n, n.__P.namespaceURI, 32 & _.__u ? [r] : null, c, r ?? Y(_), !!(32 & _.__u), l), o.__v = _.__v, o.__.__k[o.__i] = o, Qe(c, o, l), o.__e != r && Je(o)), j.length > t && j.sort(ue));
  oe.__r = 0;
}
function Ge(e, t, n, o, _, r, c, l, f, u, g) {
  var a, d, v, k, i, p, s = o && o.__k || qe, y = t.length;
  for (f = pt(n, t, s, f, y), a = 0; a < y; a++) (v = n.__k[a]) != null && (d = v.__i === -1 ? X : s[v.__i] || X, v.__i = a, p = be(e, v, d, _, r, c, l, f, u, g), k = v.__e, v.ref && d.ref != v.ref && (d.ref && ke(d.ref, null, v), g.push(v.ref, v.__c || k, v)), i == null && k != null && (i = k), 4 & v.__u || d.__k === v.__k ? f = Ke(v, f, e) : typeof v.type == "function" && p !== void 0 ? f = p : k && (f = k.nextSibling), v.__u &= -7);
  return n.__e = i, f;
}
function pt(e, t, n, o, _) {
  var r, c, l, f, u, g = n.length, a = g, d = 0;
  for (e.__k = new Array(_), r = 0; r < _; r++) (c = t[r]) != null && typeof c != "boolean" && typeof c != "function" ? (f = r + d, (c = e.__k[r] = typeof c == "string" || typeof c == "number" || typeof c == "bigint" || c.constructor == String ? G(null, c, null, null, null) : re(c) ? G(W, { children: c }, null, null, null) : c.constructor === void 0 && c.__b > 0 ? G(c.type, c.props, c.key, c.ref ? c.ref : null, c.__v) : c).__ = e, c.__b = e.__b + 1, l = null, (u = c.__i = ht(c, n, f, a)) !== -1 && (a--, (l = n[u]) && (l.__u |= 2)), l == null || l.__v === null ? (u == -1 && d--, typeof c.type != "function" && (c.__u |= 4)) : u != f && (u == f - 1 ? d-- : u == f + 1 ? d++ : (u > f ? d-- : d++, c.__u |= 4))) : e.__k[r] = null;
  if (a) for (r = 0; r < g; r++) (l = n[r]) != null && !(2 & l.__u) && (l.__e == o && (o = Y(l)), Ze(l, l));
  return o;
}
function Ke(e, t, n) {
  var o, _;
  if (typeof e.type == "function") {
    for (o = e.__k, _ = 0; o && _ < o.length; _++) o[_] && (o[_].__ = e, t = Ke(o[_], t, n));
    return t;
  }
  e.__e != t && (t && e.type && !n.contains(t) && (t = Y(e)), n.insertBefore(e.__e, t || null), t = e.__e);
  do
    t = t && t.nextSibling;
  while (t != null && t.nodeType == 8);
  return t;
}
function Xe(e, t) {
  return t = t || [], e == null || typeof e == "boolean" || (re(e) ? e.some(function(n) {
    Xe(n, t);
  }) : t.push(e)), t;
}
function ht(e, t, n, o) {
  var _, r, c = e.key, l = e.type, f = t[n];
  if (f === null || f && c == f.key && l === f.type && !(2 & f.__u)) return n;
  if (o > (f != null && !(2 & f.__u) ? 1 : 0)) for (_ = n - 1, r = n + 1; _ >= 0 || r < t.length; ) {
    if (_ >= 0) {
      if ((f = t[_]) && !(2 & f.__u) && c == f.key && l === f.type) return _;
      _--;
    }
    if (r < t.length) {
      if ((f = t[r]) && !(2 & f.__u) && c == f.key && l === f.type) return r;
      r++;
    }
  }
  return -1;
}
function Te(e, t, n) {
  t[0] == "-" ? e.setProperty(t, n ?? "") : e[t] = n == null ? "" : typeof n != "number" || ft.test(t) ? n : n + "px";
}
function V(e, t, n, o, _) {
  var r;
  e: if (t == "style") if (typeof n == "string") e.style.cssText = n;
  else {
    if (typeof o == "string" && (e.style.cssText = o = ""), o) for (t in o) n && t in n || Te(e.style, t, "");
    if (n) for (t in n) o && n[t] === o[t] || Te(e.style, t, n[t]);
  }
  else if (t[0] == "o" && t[1] == "n") r = t != (t = t.replace(ze, "$1")), t = t.toLowerCase() in e || t == "onFocusOut" || t == "onFocusIn" ? t.toLowerCase().slice(2) : t.slice(2), e.l || (e.l = {}), e.l[t + r] = n, n ? o ? n.u = o.u : (n.u = me, e.addEventListener(t, r ? pe : fe, r)) : e.removeEventListener(t, r ? pe : fe, r);
  else {
    if (_ == "http://www.w3.org/2000/svg") t = t.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
    else if (t != "width" && t != "height" && t != "href" && t != "list" && t != "form" && t != "tabIndex" && t != "download" && t != "rowSpan" && t != "colSpan" && t != "role" && t != "popover" && t in e) try {
      e[t] = n ?? "";
      break e;
    } catch {
    }
    typeof n == "function" || (n == null || n === !1 && t[4] != "-" ? e.removeAttribute(t) : e.setAttribute(t, t == "popover" && n == 1 ? "" : n));
  }
}
function $e(e) {
  return function(t) {
    if (this.l) {
      var n = this.l[t.type + e];
      if (t.t == null) t.t = me++;
      else if (t.t < n.u) return;
      return n(h.event ? h.event(t) : t);
    }
  };
}
function be(e, t, n, o, _, r, c, l, f, u) {
  var g, a, d, v, k, i, p, s, y, b, m, E, P, U, D, w, x, T = t.type;
  if (t.constructor !== void 0) return null;
  128 & n.__u && (f = !!(32 & n.__u), r = [l = t.__e = n.__e]), (g = h.__b) && g(t);
  e: if (typeof T == "function") try {
    if (s = t.props, y = "prototype" in T && T.prototype.render, b = (g = T.contextType) && o[g.__c], m = g ? b ? b.props.value : g.__ : o, n.__c ? p = (a = t.__c = n.__c).__ = a.__E : (y ? t.__c = a = new T(s, m) : (t.__c = a = new I(s, m), a.constructor = T, a.render = vt), b && b.sub(a), a.props = s, a.state || (a.state = {}), a.context = m, a.__n = o, d = a.__d = !0, a.__h = [], a._sb = []), y && a.__s == null && (a.__s = a.state), y && T.getDerivedStateFromProps != null && (a.__s == a.state && (a.__s = N({}, a.__s)), N(a.__s, T.getDerivedStateFromProps(s, a.__s))), v = a.props, k = a.state, a.__v = t, d) y && T.getDerivedStateFromProps == null && a.componentWillMount != null && a.componentWillMount(), y && a.componentDidMount != null && a.__h.push(a.componentDidMount);
    else {
      if (y && T.getDerivedStateFromProps == null && s !== v && a.componentWillReceiveProps != null && a.componentWillReceiveProps(s, m), !a.__e && (a.shouldComponentUpdate != null && a.shouldComponentUpdate(s, a.__s, m) === !1 || t.__v == n.__v)) {
        for (t.__v != n.__v && (a.props = s, a.state = a.__s, a.__d = !1), t.__e = n.__e, t.__k = n.__k, t.__k.some(function(L) {
          L && (L.__ = t);
        }), E = 0; E < a._sb.length; E++) a.__h.push(a._sb[E]);
        a._sb = [], a.__h.length && c.push(a);
        break e;
      }
      a.componentWillUpdate != null && a.componentWillUpdate(s, a.__s, m), y && a.componentDidUpdate != null && a.__h.push(function() {
        a.componentDidUpdate(v, k, i);
      });
    }
    if (a.context = m, a.props = s, a.__P = e, a.__e = !1, P = h.__r, U = 0, y) {
      for (a.state = a.__s, a.__d = !1, P && P(t), g = a.render(a.props, a.state, a.context), D = 0; D < a._sb.length; D++) a.__h.push(a._sb[D]);
      a._sb = [];
    } else do
      a.__d = !1, P && P(t), g = a.render(a.props, a.state, a.context), a.state = a.__s;
    while (a.__d && ++U < 25);
    a.state = a.__s, a.getChildContext != null && (o = N(N({}, o), a.getChildContext())), y && !d && a.getSnapshotBeforeUpdate != null && (i = a.getSnapshotBeforeUpdate(v, k)), l = Ge(e, re(w = g != null && g.type === W && g.key == null ? g.props.children : g) ? w : [w], t, n, o, _, r, c, l, f, u), a.base = t.__e, t.__u &= -161, a.__h.length && c.push(a), p && (a.__E = a.__ = null);
  } catch (L) {
    if (t.__v = null, f || r != null) if (L.then) {
      for (t.__u |= f ? 160 : 128; l && l.nodeType == 8 && l.nextSibling; ) l = l.nextSibling;
      r[r.indexOf(l)] = null, t.__e = l;
    } else for (x = r.length; x--; ) ge(r[x]);
    else t.__e = n.__e, t.__k = n.__k;
    h.__e(L, t, n);
  }
  else r == null && t.__v == n.__v ? (t.__k = n.__k, t.__e = n.__e) : l = t.__e = dt(n.__e, t, n, o, _, r, c, f, u);
  return (g = h.diffed) && g(t), 128 & t.__u ? void 0 : l;
}
function Qe(e, t, n) {
  for (var o = 0; o < n.length; o++) ke(n[o], n[++o], n[++o]);
  h.__c && h.__c(t, e), e.some(function(_) {
    try {
      e = _.__h, _.__h = [], e.some(function(r) {
        r.call(_);
      });
    } catch (r) {
      h.__e(r, _.__v);
    }
  });
}
function dt(e, t, n, o, _, r, c, l, f) {
  var u, g, a, d, v, k, i, p = n.props, s = t.props, y = t.type;
  if (y == "svg" ? _ = "http://www.w3.org/2000/svg" : y == "math" ? _ = "http://www.w3.org/1998/Math/MathML" : _ || (_ = "http://www.w3.org/1999/xhtml"), r != null) {
    for (u = 0; u < r.length; u++) if ((v = r[u]) && "setAttribute" in v == !!y && (y ? v.localName == y : v.nodeType == 3)) {
      e = v, r[u] = null;
      break;
    }
  }
  if (e == null) {
    if (y == null) return document.createTextNode(s);
    e = document.createElementNS(_, y, s.is && s), l && (h.__m && h.__m(t, r), l = !1), r = null;
  }
  if (y === null) p === s || l && e.data === s || (e.data = s);
  else {
    if (r = r && Q.call(e.childNodes), p = n.props || X, !l && r != null) for (p = {}, u = 0; u < e.attributes.length; u++) p[(v = e.attributes[u]).name] = v.value;
    for (u in p) if (v = p[u], u != "children") {
      if (u == "dangerouslySetInnerHTML") a = v;
      else if (!(u in s)) {
        if (u == "value" && "defaultValue" in s || u == "checked" && "defaultChecked" in s) continue;
        V(e, u, null, v, _);
      }
    }
    for (u in s) v = s[u], u == "children" ? d = v : u == "dangerouslySetInnerHTML" ? g = v : u == "value" ? k = v : u == "checked" ? i = v : l && typeof v != "function" || p[u] === v || V(e, u, v, p[u], _);
    if (g) l || a && (g.__html === a.__html || g.__html === e.innerHTML) || (e.innerHTML = g.__html), t.__k = [];
    else if (a && (e.innerHTML = ""), Ge(e, re(d) ? d : [d], t, n, o, y == "foreignObject" ? "http://www.w3.org/1999/xhtml" : _, r, c, r ? r[0] : n.__k && Y(n, 0), l, f), r != null) for (u = r.length; u--; ) ge(r[u]);
    l || (u = "value", y == "progress" && k == null ? e.removeAttribute("value") : k !== void 0 && (k !== e[u] || y == "progress" && !k || y == "option" && k !== p[u]) && V(e, u, k, p[u], _), u = "checked", i !== void 0 && i !== e[u] && V(e, u, i, p[u], _));
  }
  return e;
}
function ke(e, t, n) {
  try {
    if (typeof e == "function") {
      var o = typeof e.__u == "function";
      o && e.__u(), o && t == null || (e.__u = e(t));
    } else e.current = t;
  } catch (_) {
    h.__e(_, n);
  }
}
function Ze(e, t, n) {
  var o, _;
  if (h.unmount && h.unmount(e), (o = e.ref) && (o.current && o.current !== e.__e || ke(o, null, t)), (o = e.__c) != null) {
    if (o.componentWillUnmount) try {
      o.componentWillUnmount();
    } catch (r) {
      h.__e(r, t);
    }
    o.base = o.__P = null;
  }
  if (o = e.__k) for (_ = 0; _ < o.length; _++) o[_] && Ze(o[_], t, n || typeof e.type != "function");
  n || ge(e.__e), e.__c = e.__ = e.__e = void 0;
}
function vt(e, t, n) {
  return this.constructor(e, n);
}
function Ve(e, t, n) {
  var o, _, r, c;
  t == document && (t = document.documentElement), h.__ && h.__(e, t), _ = (o = typeof n == "function") ? null : n && n.__k || t.__k, r = [], c = [], be(t, e = (!o && n || t).__k = F(W, null, [e]), _ || X, X, t.namespaceURI, !o && n ? [n] : _ ? null : t.firstChild ? Q.call(t.childNodes) : null, r, !o && n ? n : _ ? _.__e : t.firstChild, o, c), Qe(r, e, c);
}
function et(e, t) {
  Ve(e, t, et);
}
function Se(e, t, n) {
  var o, _, r, c, l = N({}, e.props);
  for (r in e.type && e.type.defaultProps && (c = e.type.defaultProps), t) r == "key" ? o = t[r] : r == "ref" ? _ = t[r] : l[r] = t[r] === void 0 && c !== void 0 ? c[r] : t[r];
  return arguments.length > 2 && (l.children = arguments.length > 3 ? Q.call(arguments, 2) : n), G(e.type, l, o || e.key, _ || e.ref, null);
}
function tt(e, t) {
  var n = { __c: t = "__cC" + Ye++, __: e, Consumer: function(o, _) {
    return o.children(_);
  }, Provider: function(o) {
    var _, r;
    return this.getChildContext || (_ = /* @__PURE__ */ new Set(), (r = {})[t] = this, this.getChildContext = function() {
      return r;
    }, this.componentWillUnmount = function() {
      _ = null;
    }, this.shouldComponentUpdate = function(c) {
      this.props.value !== c.value && _.forEach(function(l) {
        l.__e = !0, he(l);
      });
    }, this.sub = function(c) {
      _.add(c);
      var l = c.componentWillUnmount;
      c.componentWillUnmount = function() {
        _ && _.delete(c), l && l.call(c);
      };
    }), o.children;
  } };
  return n.Provider.__ = n.Consumer.contextType = n;
}
Q = qe.slice, h = { __e: function(e, t, n, o) {
  for (var _, r, c; t = t.__; ) if ((_ = t.__c) && !_.__) try {
    if ((r = _.constructor) && r.getDerivedStateFromError != null && (_.setState(r.getDerivedStateFromError(e)), c = _.__d), _.componentDidCatch != null && (_.componentDidCatch(e, o || {}), c = _.__d), c) return _.__E = _;
  } catch (l) {
    e = l;
  }
  throw e;
} }, We = 0, I.prototype.setState = function(e, t) {
  var n;
  n = this.__s != null && this.__s !== this.state ? this.__s : this.__s = N({}, this.state), typeof e == "function" && (e = e(N({}, n), this.props)), e && N(n, e), e != null && this.__v && (t && this._sb.push(t), he(this));
}, I.prototype.forceUpdate = function(e) {
  this.__v && (this.__e = !0, e && this.__h.push(e), he(this));
}, I.prototype.render = W, j = [], Be = typeof Promise == "function" ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout, ue = function(e, t) {
  return e.__v.__b - t.__v.__b;
}, oe.__r = 0, ze = /(PointerCapture)$|Capture$/i, me = 0, fe = $e(!1), pe = $e(!0), Ye = 0;
var yt = 0;
function H(e, t, n, o, _, r) {
  t || (t = {});
  var c, l, f = t;
  if ("ref" in f) for (l in f = {}, t) l == "ref" ? c = t[l] : f[l] = t[l];
  var u = { type: e, props: f, key: n, ref: c, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: --yt, __i: -1, __u: 0, __source: _, __self: r };
  if (typeof e == "function" && (c = e.defaultProps)) for (l in c) f[l] === void 0 && (f[l] = c[l]);
  return h.vnode && h.vnode(u), u;
}
var q, $, ie, Ce, de = 0, nt = [], S = h, xe = S.__b, Pe = S.__r, He = S.diffed, Ue = S.__c, De = S.unmount, Oe = S.__;
function _e(e, t) {
  S.__h && S.__h($, e, de || t), de = 0;
  var n = $.__H || ($.__H = { __: [], __h: [] });
  return e >= n.__.length && n.__.push({}), n.__[e];
}
function ot(e, t, n) {
  var o = _e(q++, 2);
  if (o.t = e, !o.__c && (o.__ = [bt(void 0, t), function(l) {
    var f = o.__N ? o.__N[0] : o.__[0], u = o.t(f, l);
    f !== u && (o.__N = [u, o.__[1]], o.__c.setState({}));
  }], o.__c = $, !$.u)) {
    var _ = function(l, f, u) {
      if (!o.__c.__H) return !0;
      var g = o.__c.__H.__.filter(function(d) {
        return !!d.__c;
      });
      if (g.every(function(d) {
        return !d.__N;
      })) return !r || r.call(this, l, f, u);
      var a = o.__c.props !== l;
      return g.forEach(function(d) {
        if (d.__N) {
          var v = d.__[0];
          d.__ = d.__N, d.__N = void 0, v !== d.__[0] && (a = !0);
        }
      }), r && r.call(this, l, f, u) || a;
    };
    $.u = !0;
    var r = $.shouldComponentUpdate, c = $.componentWillUpdate;
    $.componentWillUpdate = function(l, f, u) {
      if (this.__e) {
        var g = r;
        r = void 0, _(l, f, u), r = g;
      }
      c && c.call(this, l, f, u);
    }, $.shouldComponentUpdate = _;
  }
  return o.__N || o.__;
}
function rt(e, t) {
  var n = _e(q++, 4);
  !S.__s && it(n.__H, t) && (n.__ = e, n.i = t, $.__h.push(n));
}
function R(e) {
  return de = 5, we(function() {
    return { current: e };
  }, []);
}
function we(e, t) {
  var n = _e(q++, 7);
  return it(n.__H, t) && (n.__ = e(), n.__H = t, n.__h = e), n.__;
}
function _t(e) {
  var t = $.context[e.__c], n = _e(q++, 9);
  return n.c = e, t ? (n.__ == null && (n.__ = !0, t.sub($)), t.props.value) : e.__;
}
function mt() {
  for (var e; e = nt.shift(); ) if (e.__P && e.__H) try {
    e.__H.__h.forEach(ne), e.__H.__h.forEach(ve), e.__H.__h = [];
  } catch (t) {
    e.__H.__h = [], S.__e(t, e.__v);
  }
}
S.__b = function(e) {
  $ = null, xe && xe(e);
}, S.__ = function(e, t) {
  e && t.__k && t.__k.__m && (e.__m = t.__k.__m), Oe && Oe(e, t);
}, S.__r = function(e) {
  Pe && Pe(e), q = 0;
  var t = ($ = e.__c).__H;
  t && (ie === $ ? (t.__h = [], $.__h = [], t.__.forEach(function(n) {
    n.__N && (n.__ = n.__N), n.i = n.__N = void 0;
  })) : (t.__h.forEach(ne), t.__h.forEach(ve), t.__h = [], q = 0)), ie = $;
}, S.diffed = function(e) {
  He && He(e);
  var t = e.__c;
  t && t.__H && (t.__H.__h.length && (nt.push(t) !== 1 && Ce === S.requestAnimationFrame || ((Ce = S.requestAnimationFrame) || gt)(mt)), t.__H.__.forEach(function(n) {
    n.i && (n.__H = n.i), n.i = void 0;
  })), ie = $ = null;
}, S.__c = function(e, t) {
  t.some(function(n) {
    try {
      n.__h.forEach(ne), n.__h = n.__h.filter(function(o) {
        return !o.__ || ve(o);
      });
    } catch (o) {
      t.some(function(_) {
        _.__h && (_.__h = []);
      }), t = [], S.__e(o, n.__v);
    }
  }), Ue && Ue(e, t);
}, S.unmount = function(e) {
  De && De(e);
  var t, n = e.__c;
  n && n.__H && (n.__H.__.forEach(function(o) {
    try {
      ne(o);
    } catch (_) {
      t = _;
    }
  }), n.__H = void 0, t && S.__e(t, n.__v));
};
var Le = typeof requestAnimationFrame == "function";
function gt(e) {
  var t, n = function() {
    clearTimeout(o), Le && cancelAnimationFrame(t), setTimeout(e);
  }, o = setTimeout(n, 100);
  Le && (t = requestAnimationFrame(n));
}
function ne(e) {
  var t = $, n = e.__c;
  typeof n == "function" && (e.__c = void 0, n()), $ = t;
}
function ve(e) {
  var t = $;
  e.__c = e.__(), $ = t;
}
function it(e, t) {
  return !e || e.length !== t.length || t.some(function(n, o) {
    return n !== e[o];
  });
}
function bt(e, t) {
  return typeof t == "function" ? t(e) : t;
}
let A, J;
const kt = (e, t) => {
  if (A = void 0, t && t.type === "click") {
    if (t.ctrlKey || t.metaKey || t.altKey || t.shiftKey || t.button !== 0)
      return e;
    const n = t.target.closest("a[href]"), o = n && n.getAttribute("href");
    if (!n || n.origin != globalThis.location.origin || /^#/.test(o) || !/^(_?self)?$/i.test(n.target) || J && (typeof J == "string" ? !o.startsWith(J) : !J.test(o)))
      return e;
    A = !0, t.preventDefault(), t = n.href.replace(globalThis.location.origin, "");
  } else typeof t == "string" ? A = !0 : t && t.url ? (A = !t.replace, t = t.url) : t = globalThis.location.pathname + globalThis.location.search;
  return A === !0 ? history.pushState(null, "", t) : A === !1 && history.replaceState(null, "", t), t;
}, wt = (e, t, n = {}) => {
  e = e.split("/").filter(Boolean), t = (t || "").split("/").filter(Boolean), n.params || (n.params = {});
  for (let o = 0, _, r; o < Math.max(e.length, t.length); o++) {
    let [, c, l, f] = (t[o] || "").match(/^(:?)(.*?)([+*?]?)$/);
    if (_ = e[o], !(!c && l == _)) {
      if (!c && _ && f == "*") {
        n.rest = "/" + e.slice(o).map(decodeURIComponent).join("/");
        break;
      }
      if (!c || !_ && f != "?" && f != "*") return;
      if (r = f == "+" || f == "*", r ? _ = e.slice(o).map(decodeURIComponent).join("/") || void 0 : _ && (_ = decodeURIComponent(_)), n.params[l] = _, l in n || (n[l] = _), r) break;
    }
  }
  return n;
};
function Z(e) {
  const [t, n] = ot(
    kt,
    e.url || globalThis.location.pathname + globalThis.location.search
  );
  e.scope && (J = e.scope);
  const o = A === !0, _ = we(() => {
    const r = new URL(t, globalThis.location.origin), c = r.pathname.replace(/\/+$/g, "") || "/";
    return {
      url: t,
      path: c,
      query: Object.fromEntries(r.searchParams),
      route: (l, f) => n({ url: l, replace: f }),
      wasPush: o
    };
  }, [t]);
  return rt(() => (addEventListener("click", n), addEventListener("popstate", n), () => {
    removeEventListener("click", n), removeEventListener("popstate", n);
  }), []), F(Z.ctx.Provider, { value: _ }, e.children);
}
const Et = Promise.resolve();
function at(e) {
  const [t, n] = ot((w) => w + 1, 0), { url: o, query: _, wasPush: r, path: c } = Tt(), { rest: l = c, params: f = {} } = _t(Me), u = R(!1), g = R(c), a = R(0), d = (
    /** @type {RefObject<VNode<any>>} */
    R()
  ), v = (
    /** @type {RefObject<VNode<any>>} */
    R()
  ), k = (
    /** @type {RefObject<Element | Text>} */
    R()
  ), i = R(!1), p = (
    /** @type {RefObject<boolean>} */
    R()
  );
  p.current = !1;
  const s = R(!1);
  let y, b, m;
  Xe(e.children).some((w) => {
    if (wt(
      l,
      w.props.path,
      m = { ...w.props, path: l, query: _, params: f, rest: "" }
    )) return y = Se(w, m);
    w.props.default && (b = Se(w, m));
  });
  let E = y || b;
  we(() => {
    v.current = d.current;
    const w = v.current && v.current.props.children;
    !w || !E || E.type !== w.type || E.props.component !== w.props.component ? (this.__v && this.__v.__k && this.__v.__k.reverse(), a.current++, s.current = !0) : s.current = !1;
  }, [o]);
  const P = d.current && d.current.__u & ee && d.current.__u & te, U = d.current && d.current.__h;
  d.current = /** @type {VNode<any>} */
  F(Me.Provider, { value: m }, E), P ? (d.current.__u |= ee, d.current.__u |= te) : U && (d.current.__h = !0);
  const D = v.current;
  return v.current = null, this.__c = (w, x) => {
    p.current = !0, v.current = D, e.onLoadStart && e.onLoadStart(o), u.current = !0;
    let T = a.current;
    w.then(() => {
      T === a.current && (v.current = null, d.current && (x.__h && (d.current.__h = x.__h), x.__u & te && (d.current.__u |= te), x.__u & ee && (d.current.__u |= ee)), Et.then(n));
    });
  }, rt(() => {
    const w = this.__v && this.__v.__e;
    if (p.current) {
      !i.current && !k.current && (k.current = w);
      return;
    }
    !i.current && k.current && (k.current !== w && k.current.remove(), k.current = null), i.current = !0, g.current !== c && (r && scrollTo(0, 0), e.onRouteChange && e.onRouteChange(o), g.current = c), e.onLoadEnd && u.current && e.onLoadEnd(o), u.current = !1;
  }, [c, r, t]), s.current ? [F(ae, { r: d }), F(ae, { r: v })] : F(ae, { r: d });
}
const ee = 32, te = 128, ae = ({ r: e }) => e.current;
at.Provider = Z;
Z.ctx = tt(
  /** @type {import('./router.d.ts').LocationHook & { wasPush: boolean }} */
  {}
);
const Me = tt(
  /** @type {import('./router.d.ts').RouteHook & { rest: string }} */
  {}
), Re = (e) => F(e.component, e), Tt = () => _t(Z.ctx), Ne = h.__b;
h.__b = (e) => {
  e.type && e.type._forwarded && e.ref && (e.props.ref = e.ref, e.ref = null), Ne && Ne(e);
};
const Ie = h.__e;
h.__e = (e, t, n) => {
  if (e && e.then) {
    let o = t;
    for (; o = o.__; )
      if (o.__c && o.__c.__c)
        return t.__e == null && (t.__e = n.__e, t.__k = n.__k), t.__k || (t.__k = []), o.__c.__c(e, t);
  }
  Ie && Ie(e, t, n);
};
let Ae;
function $t(e, t) {
  if (typeof window > "u") return;
  let n = document.querySelector("script[type=isodata]");
  t = t || n && n.parentNode || document.body, !Ae && n ? et(e, t) : Ve(e, t), Ae = !0;
}
var ce;
(ce = typeof globalThis < "u" ? globalThis : typeof window < "u" ? window : void 0) != null && ce.__PREACT_DEVTOOLS__ && ce.__PREACT_DEVTOOLS__.attachPreact("10.25.4", h, { Fragment: W, Component: I });
var je = {};
function M(e) {
  return e.type === W ? "Fragment" : typeof e.type == "function" ? e.type.displayName || e.type.name : typeof e.type == "string" ? e.type : "#text";
}
var K = [], z = [];
function ct() {
  return K.length > 0 ? K[K.length - 1] : null;
}
var Fe = !0;
function le(e) {
  return typeof e.type == "function" && e.type != W;
}
function C(e) {
  for (var t = [e], n = e; n.__o != null; ) t.push(n.__o), n = n.__o;
  return t.reduce(function(o, _) {
    o += "  in " + M(_);
    var r = _.__source;
    return r ? o += " (at " + r.fileName + ":" + r.lineNumber + ")" : Fe && console.warn("Add @babel/plugin-transform-react-jsx-source to get a more detailed component stack. Note that you should not add it to production builds of your App for bundle size reasons."), Fe = !1, o + `
`;
  }, "");
}
var St = typeof WeakMap == "function";
function ye(e) {
  var t = [];
  return e.__k && e.__k.forEach(function(n) {
    n && typeof n.type == "function" ? t.push.apply(t, ye(n)) : n && typeof n.type == "string" && t.push(n.type);
  }), t;
}
function lt(e) {
  return e ? typeof e.type == "function" ? e.__ == null ? e.__e != null && e.__e.parentNode != null ? e.__e.parentNode.localName : "" : lt(e.__) : e.type : "";
}
var Ct = I.prototype.setState;
function se(e) {
  return e === "table" || e === "tfoot" || e === "tbody" || e === "thead" || e === "td" || e === "tr" || e === "th";
}
I.prototype.setState = function(e, t) {
  return this.__v == null && this.state == null && console.warn(`Calling "this.setState" inside the constructor of a component is a no-op and might be a bug in your application. Instead, set "this.state = {}" directly.

` + C(ct())), Ct.call(this, e, t);
};
var xt = /^(address|article|aside|blockquote|details|div|dl|fieldset|figcaption|figure|footer|form|h1|h2|h3|h4|h5|h6|header|hgroup|hr|main|menu|nav|ol|p|pre|search|section|table|ul)$/, Pt = I.prototype.forceUpdate;
function O(e) {
  var t = e.props, n = M(e), o = "";
  for (var _ in t) if (t.hasOwnProperty(_) && _ !== "children") {
    var r = t[_];
    typeof r == "function" && (r = "function " + (r.displayName || r.name) + "() {}"), r = Object(r) !== r || r.toString ? r + "" : Object.prototype.toString.call(r), o += " " + _ + "=" + JSON.stringify(r);
  }
  var c = t.children;
  return "<" + n + o + (c && c.length ? ">..</" + n + ">" : " />");
}
I.prototype.forceUpdate = function(e) {
  return this.__v == null ? console.warn(`Calling "this.forceUpdate" inside the constructor of a component is a no-op and might be a bug in your application.

` + C(ct())) : this.__P == null && console.warn(`Can't call "this.forceUpdate" on an unmounted component. This is a no-op, but it indicates a memory leak in your application. To fix, cancel all subscriptions and asynchronous tasks in the componentWillUnmount method.

` + C(this.__v)), Pt.call(this, e);
}, h.__m = function(e, t) {
  var n = e.type, o = t.map(function(_) {
    return _ && _.localName;
  }).filter(Boolean);
  console.error('Expected a DOM node of type "' + n + '" but found "' + o.join(", ") + `" as available DOM-node(s), this is caused by the SSR'd HTML containing different DOM-nodes compared to the hydrated one.

` + C(e));
}, function() {
  (function() {
    var i = h.__b, p = h.diffed, s = h.__, y = h.vnode, b = h.__r;
    h.diffed = function(m) {
      le(m) && z.pop(), K.pop(), p && p(m);
    }, h.__b = function(m) {
      le(m) && K.push(m), i && i(m);
    }, h.__ = function(m, E) {
      z = [], s && s(m, E);
    }, h.vnode = function(m) {
      m.__o = z.length > 0 ? z[z.length - 1] : null, y && y(m);
    }, h.__r = function(m) {
      le(m) && z.push(m), b && b(m);
    };
  })();
  var e = !1, t = h.__b, n = h.diffed, o = h.vnode, _ = h.__r, r = h.__e, c = h.__, l = h.__h, f = St ? { lazyPropTypes: /* @__PURE__ */ new WeakMap() } : null, u = [];
  h.__e = function(i, p, s, y) {
    if (p && p.__c && typeof i.then == "function") {
      var b = i;
      i = new Error("Missing Suspense. The throwing component was: " + M(p));
      for (var m = p; m; m = m.__) if (m.__c && m.__c.__c) {
        i = b;
        break;
      }
      if (i instanceof Error) throw i;
    }
    try {
      (y = y || {}).componentStack = C(p), r(i, p, s, y), typeof i.then != "function" && setTimeout(function() {
        throw i;
      });
    } catch (E) {
      throw E;
    }
  }, h.__ = function(i, p) {
    if (!p) throw new Error(`Undefined parent passed to render(), this is the second argument.
Check if the element is available in the DOM/has the correct id.`);
    var s;
    switch (p.nodeType) {
      case 1:
      case 11:
      case 9:
        s = !0;
        break;
      default:
        s = !1;
    }
    if (!s) {
      var y = M(i);
      throw new Error("Expected a valid HTML node as a second argument to render.	Received " + p + " instead: render(<" + y + " />, " + p + ");");
    }
    c && c(i, p);
  }, h.__b = function(i) {
    var p = i.type;
    if (e = !0, p === void 0) throw new Error(`Undefined component passed to createElement()

You likely forgot to export your component or might have mixed up default and named imports` + O(i) + `

` + C(i));
    if (p != null && typeof p == "object")
      throw p.__k !== void 0 && p.__e !== void 0 ? new Error("Invalid type passed to createElement(): " + p + `

Did you accidentally pass a JSX literal as JSX twice?

  let My` + M(i) + " = " + O(p) + `;
  let vnode = <My` + M(i) + ` />;

This usually happens when you export a JSX literal and not the component.

` + C(i)) : new Error("Invalid type passed to createElement(): " + (Array.isArray(p) ? "array" : p));
    if (i.ref !== void 0 && typeof i.ref != "function" && typeof i.ref != "object" && !("$$typeof" in i)) throw new Error(`Component's "ref" property should be a function, or an object created by createRef(), but got [` + typeof i.ref + `] instead
` + O(i) + `

` + C(i));
    if (typeof i.type == "string") {
      for (var s in i.props) if (s[0] === "o" && s[1] === "n" && typeof i.props[s] != "function" && i.props[s] != null) throw new Error(`Component's "` + s + '" property should be a function, but got [' + typeof i.props[s] + `] instead
` + O(i) + `

` + C(i));
    }
    if (typeof i.type == "function" && i.type.propTypes) {
      if (i.type.displayName === "Lazy" && f && !f.lazyPropTypes.has(i.type)) {
        var y = "PropTypes are not supported on lazy(). Use propTypes on the wrapped component itself. ";
        try {
          var b = i.type();
          f.lazyPropTypes.set(i.type, !0), console.warn(y + "Component wrapped in lazy() is " + M(b));
        } catch {
          console.warn(y + "We will log the wrapped component's name once it is loaded.");
        }
      }
      var m = i.props;
      i.type.__f && delete (m = function(E, P) {
        for (var U in P) E[U] = P[U];
        return E;
      }({}, m)).ref, function(E, P, U, D, w) {
        Object.keys(E).forEach(function(x) {
          var T;
          try {
            T = E[x](P, x, D, "prop", null, "SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED");
          } catch (L) {
            T = L;
          }
          T && !(T.message in je) && (je[T.message] = !0, console.error("Failed prop type: " + T.message + (w && `
` + w() || "")));
        });
      }(i.type.propTypes, m, 0, M(i), function() {
        return C(i);
      });
    }
    t && t(i);
  };
  var g, a = 0;
  h.__r = function(i) {
    _ && _(i), e = !0;
    var p = i.__c;
    if (p === g ? a++ : a = 1, a >= 25) throw new Error("Too many re-renders. This is limited to prevent an infinite loop which may lock up your browser. The component causing this is: " + M(i));
    g = p;
  }, h.__h = function(i, p, s) {
    if (!i || !e) throw new Error("Hook can only be invoked from render methods.");
    l && l(i, p, s);
  };
  var d = function(i, p) {
    return { get: function() {
      var s = "get" + i + p;
      u && u.indexOf(s) < 0 && (u.push(s), console.warn("getting vnode." + i + " is deprecated, " + p));
    }, set: function() {
      var s = "set" + i + p;
      u && u.indexOf(s) < 0 && (u.push(s), console.warn("setting vnode." + i + " is not allowed, " + p));
    } };
  }, v = { nodeName: d("nodeName", "use vnode.type"), attributes: d("attributes", "use vnode.props"), children: d("children", "use vnode.props.children") }, k = Object.create({}, v);
  h.vnode = function(i) {
    var p = i.props;
    if (i.type !== null && p != null && ("__source" in p || "__self" in p)) {
      var s = i.props = {};
      for (var y in p) {
        var b = p[y];
        y === "__source" ? i.__source = b : y === "__self" ? i.__self = b : s[y] = b;
      }
    }
    i.__proto__ = k, o && o(i);
  }, h.diffed = function(i) {
    var p, s = i.type, y = i.__;
    if (i.__k && i.__k.forEach(function(B) {
      if (typeof B == "object" && B && B.type === void 0) {
        var ut = Object.keys(B).join(",");
        throw new Error("Objects are not valid as a child. Encountered an object with the keys {" + ut + `}.

` + C(i));
      }
    }), i.__c === g && (a = 0), typeof s == "string" && (se(s) || s === "p" || s === "a" || s === "button")) {
      var b = lt(y);
      if (b !== "" && se(s)) s === "table" && b !== "td" && se(b) ? (console.log(b, y.__e), console.error("Improper nesting of table. Your <table> should not have a table-node parent." + O(i) + `

` + C(i))) : s !== "thead" && s !== "tfoot" && s !== "tbody" || b === "table" ? s === "tr" && b !== "thead" && b !== "tfoot" && b !== "tbody" ? console.error("Improper nesting of table. Your <tr> should have a <thead/tbody/tfoot> parent." + O(i) + `

` + C(i)) : s === "td" && b !== "tr" ? console.error("Improper nesting of table. Your <td> should have a <tr> parent." + O(i) + `

` + C(i)) : s === "th" && b !== "tr" && console.error("Improper nesting of table. Your <th> should have a <tr>." + O(i) + `

` + C(i)) : console.error("Improper nesting of table. Your <thead/tbody/tfoot> should have a <table> parent." + O(i) + `

` + C(i));
      else if (s === "p") {
        var m = ye(i).filter(function(B) {
          return xt.test(B);
        });
        m.length && console.error("Improper nesting of paragraph. Your <p> should not have " + m.join(", ") + " as child-elements." + O(i) + `

` + C(i));
      } else s !== "a" && s !== "button" || ye(i).indexOf(s) !== -1 && console.error("Improper nesting of interactive content. Your <" + s + "> should not have other " + (s === "a" ? "anchor" : "button") + " tags as child-elements." + O(i) + `

` + C(i));
    }
    if (e = !1, n && n(i), i.__k != null) for (var E = [], P = 0; P < i.__k.length; P++) {
      var U = i.__k[P];
      if (U && U.key != null) {
        var D = U.key;
        if (E.indexOf(D) !== -1) {
          console.error('Following component has two or more children with the same key attribute: "' + D + `". This may cause glitches and misbehavior in rendering process. Component: 

` + O(i) + `

` + C(i));
          break;
        }
        E.push(D);
      }
    }
    if (i.__c != null && i.__c.__H != null) {
      var w = i.__c.__H.__;
      if (w) for (var x = 0; x < w.length; x += 1) {
        var T = w[x];
        if (T.__H) {
          for (var L = 0; L < T.__H.length; L++) if ((p = T.__H[L]) != p) {
            var st = M(i);
            console.warn("Invalid argument passed to hook. Hooks should not be called with NaN in the dependency array. Hook index " + x + " in component " + st + " was called with NaN.");
          }
        }
      }
    }
  };
}();
const Ht = () => /* @__PURE__ */ H("section", { children: [
  /* @__PURE__ */ H("a", { href: "/test", children: "test" }),
  /* @__PURE__ */ H("h1", { children: "Hello Hono!" }),
  /* @__PURE__ */ H("ul", { children: Dt.map((e) => /* @__PURE__ */ H("li", { children: [
    e,
    "!!"
  ] })) }),
  /* @__PURE__ */ H("button", { onClick: console.log, children: "hello World" })
] }), Ut = () => /* @__PURE__ */ H("section", { children: [
  /* @__PURE__ */ H("a", { href: "/", children: "home" }),
  /* @__PURE__ */ H("p", { children: "test" })
] }), Dt = ["Good Morning", "Good Evening", "Good Night"], Ot = (e) => /* @__PURE__ */ H(Z, { children: /* @__PURE__ */ H(at, { children: e.children }) }), Lt = () => /* @__PURE__ */ H(Ot, { children: [
  /* @__PURE__ */ H(Re, { path: "/", component: Ht }),
  /* @__PURE__ */ H(Re, { path: "/test", component: Ut })
] }), Mt = document.getElementById("app");
$t(/* @__PURE__ */ H(Lt, {}), Mt);
export {
  Lt as App
};
//# sourceMappingURL=client.js.map
