var Q, h, ze, j, $e, Be, fe, Ye, me, pe, he, qe, X = {}, Je = [], ht = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i, _e = Array.isArray;
function R(e, t) {
  for (var n in t) e[n] = t[n];
  return e;
}
function ge(e) {
  e && e.parentNode && e.parentNode.removeChild(e);
}
function A(e, t, n) {
  var o, _, r, c = {};
  for (r in t) r == "key" ? o = t[r] : r == "ref" ? _ = t[r] : c[r] = t[r];
  if (arguments.length > 2 && (c.children = arguments.length > 3 ? Q.call(arguments, 2) : n), typeof e == "function" && e.defaultProps != null) for (r in e.defaultProps) c[r] === void 0 && (c[r] = e.defaultProps[r]);
  return G(e, c, o, _, null);
}
function G(e, t, n, o, _) {
  var r = { type: e, props: t, key: n, ref: o, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: _ ?? ++ze, __i: -1, __u: 0 };
  return _ == null && h.vnode != null && h.vnode(r), r;
}
function F(e) {
  return e.children;
}
function N(e, t) {
  this.props = e, this.context = t;
}
function Y(e, t) {
  if (t == null) return e.__ ? Y(e.__, e.__i + 1) : null;
  for (var n; t < e.__k.length; t++) if ((n = e.__k[t]) != null && n.__e != null) return n.__e;
  return typeof e.type == "function" ? Y(e) : null;
}
function Ge(e) {
  var t, n;
  if ((e = e.__) != null && e.__c != null) {
    for (e.__e = e.__c.base = null, t = 0; t < e.__k.length; t++) if ((n = e.__k[t]) != null && n.__e != null) {
      e.__e = e.__c.base = n.__e;
      break;
    }
    return Ge(e);
  }
}
function de(e) {
  (!e.__d && (e.__d = !0) && j.push(e) && !oe.__r++ || $e !== h.debounceRendering) && (($e = h.debounceRendering) || Be)(oe);
}
function oe() {
  var e, t, n, o, _, r, c, u;
  for (j.sort(fe); e = j.shift(); ) e.__d && (t = j.length, o = void 0, r = (_ = (n = e).__v).__e, c = [], u = [], n.__P && ((o = R({}, _)).__v = _.__v + 1, h.vnode && h.vnode(o), be(n.__P, o, _, n.__n, n.__P.namespaceURI, 32 & _.__u ? [r] : null, c, r ?? Y(_), !!(32 & _.__u), u), o.__v = _.__v, o.__.__k[o.__i] = o, Ze(c, o, u), o.__e != r && Ge(o)), j.length > t && j.sort(fe));
  oe.__r = 0;
}
function Ke(e, t, n, o, _, r, c, u, f, l, g) {
  var a, d, v, w, i, p, s = o && o.__k || Je, y = t.length;
  for (f = dt(n, t, s, f, y), a = 0; a < y; a++) (v = n.__k[a]) != null && (d = v.__i === -1 ? X : s[v.__i] || X, v.__i = a, p = be(e, v, d, _, r, c, u, f, l, g), w = v.__e, v.ref && d.ref != v.ref && (d.ref && we(d.ref, null, v), g.push(v.ref, v.__c || w, v)), i == null && w != null && (i = w), 4 & v.__u || d.__k === v.__k ? f = Xe(v, f, e) : typeof v.type == "function" && p !== void 0 ? f = p : w && (f = w.nextSibling), v.__u &= -7);
  return n.__e = i, f;
}
function dt(e, t, n, o, _) {
  var r, c, u, f, l, g = n.length, a = g, d = 0;
  for (e.__k = new Array(_), r = 0; r < _; r++) (c = t[r]) != null && typeof c != "boolean" && typeof c != "function" ? (f = r + d, (c = e.__k[r] = typeof c == "string" || typeof c == "number" || typeof c == "bigint" || c.constructor == String ? G(null, c, null, null, null) : _e(c) ? G(F, { children: c }, null, null, null) : c.constructor === void 0 && c.__b > 0 ? G(c.type, c.props, c.key, c.ref ? c.ref : null, c.__v) : c).__ = e, c.__b = e.__b + 1, u = null, (l = c.__i = vt(c, n, f, a)) !== -1 && (a--, (u = n[l]) && (u.__u |= 2)), u == null || u.__v === null ? (l == -1 && d--, typeof c.type != "function" && (c.__u |= 4)) : l != f && (l == f - 1 ? d-- : l == f + 1 ? d++ : (l > f ? d-- : d++, c.__u |= 4))) : e.__k[r] = null;
  if (a) for (r = 0; r < g; r++) (u = n[r]) != null && !(2 & u.__u) && (u.__e == o && (o = Y(u)), Ve(u, u));
  return o;
}
function Xe(e, t, n) {
  var o, _;
  if (typeof e.type == "function") {
    for (o = e.__k, _ = 0; o && _ < o.length; _++) o[_] && (o[_].__ = e, t = Xe(o[_], t, n));
    return t;
  }
  e.__e != t && (t && e.type && !n.contains(t) && (t = Y(e)), n.insertBefore(e.__e, t || null), t = e.__e);
  do
    t = t && t.nextSibling;
  while (t != null && t.nodeType == 8);
  return t;
}
function Qe(e, t) {
  return t = t || [], e == null || typeof e == "boolean" || (_e(e) ? e.some(function(n) {
    Qe(n, t);
  }) : t.push(e)), t;
}
function vt(e, t, n, o) {
  var _, r, c = e.key, u = e.type, f = t[n];
  if (f === null || f && c == f.key && u === f.type && !(2 & f.__u)) return n;
  if (o > (f != null && !(2 & f.__u) ? 1 : 0)) for (_ = n - 1, r = n + 1; _ >= 0 || r < t.length; ) {
    if (_ >= 0) {
      if ((f = t[_]) && !(2 & f.__u) && c == f.key && u === f.type) return _;
      _--;
    }
    if (r < t.length) {
      if ((f = t[r]) && !(2 & f.__u) && c == f.key && u === f.type) return r;
      r++;
    }
  }
  return -1;
}
function Te(e, t, n) {
  t[0] == "-" ? e.setProperty(t, n ?? "") : e[t] = n == null ? "" : typeof n != "number" || ht.test(t) ? n : n + "px";
}
function V(e, t, n, o, _) {
  var r;
  e: if (t == "style") if (typeof n == "string") e.style.cssText = n;
  else {
    if (typeof o == "string" && (e.style.cssText = o = ""), o) for (t in o) n && t in n || Te(e.style, t, "");
    if (n) for (t in n) o && n[t] === o[t] || Te(e.style, t, n[t]);
  }
  else if (t[0] == "o" && t[1] == "n") r = t != (t = t.replace(Ye, "$1")), t = t.toLowerCase() in e || t == "onFocusOut" || t == "onFocusIn" ? t.toLowerCase().slice(2) : t.slice(2), e.l || (e.l = {}), e.l[t + r] = n, n ? o ? n.u = o.u : (n.u = me, e.addEventListener(t, r ? he : pe, r)) : e.removeEventListener(t, r ? he : pe, r);
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
function Se(e) {
  return function(t) {
    if (this.l) {
      var n = this.l[t.type + e];
      if (t.t == null) t.t = me++;
      else if (t.t < n.u) return;
      return n(h.event ? h.event(t) : t);
    }
  };
}
function be(e, t, n, o, _, r, c, u, f, l) {
  var g, a, d, v, w, i, p, s, y, b, m, E, P, H, U, k, x, $ = t.type;
  if (t.constructor !== void 0) return null;
  128 & n.__u && (f = !!(32 & n.__u), r = [u = t.__e = n.__e]), (g = h.__b) && g(t);
  e: if (typeof $ == "function") try {
    if (s = t.props, y = "prototype" in $ && $.prototype.render, b = (g = $.contextType) && o[g.__c], m = g ? b ? b.props.value : g.__ : o, n.__c ? p = (a = t.__c = n.__c).__ = a.__E : (y ? t.__c = a = new $(s, m) : (t.__c = a = new N(s, m), a.constructor = $, a.render = mt), b && b.sub(a), a.props = s, a.state || (a.state = {}), a.context = m, a.__n = o, d = a.__d = !0, a.__h = [], a._sb = []), y && a.__s == null && (a.__s = a.state), y && $.getDerivedStateFromProps != null && (a.__s == a.state && (a.__s = R({}, a.__s)), R(a.__s, $.getDerivedStateFromProps(s, a.__s))), v = a.props, w = a.state, a.__v = t, d) y && $.getDerivedStateFromProps == null && a.componentWillMount != null && a.componentWillMount(), y && a.componentDidMount != null && a.__h.push(a.componentDidMount);
    else {
      if (y && $.getDerivedStateFromProps == null && s !== v && a.componentWillReceiveProps != null && a.componentWillReceiveProps(s, m), !a.__e && (a.shouldComponentUpdate != null && a.shouldComponentUpdate(s, a.__s, m) === !1 || t.__v == n.__v)) {
        for (t.__v != n.__v && (a.props = s, a.state = a.__s, a.__d = !1), t.__e = n.__e, t.__k = n.__k, t.__k.some(function(L) {
          L && (L.__ = t);
        }), E = 0; E < a._sb.length; E++) a.__h.push(a._sb[E]);
        a._sb = [], a.__h.length && c.push(a);
        break e;
      }
      a.componentWillUpdate != null && a.componentWillUpdate(s, a.__s, m), y && a.componentDidUpdate != null && a.__h.push(function() {
        a.componentDidUpdate(v, w, i);
      });
    }
    if (a.context = m, a.props = s, a.__P = e, a.__e = !1, P = h.__r, H = 0, y) {
      for (a.state = a.__s, a.__d = !1, P && P(t), g = a.render(a.props, a.state, a.context), U = 0; U < a._sb.length; U++) a.__h.push(a._sb[U]);
      a._sb = [];
    } else do
      a.__d = !1, P && P(t), g = a.render(a.props, a.state, a.context), a.state = a.__s;
    while (a.__d && ++H < 25);
    a.state = a.__s, a.getChildContext != null && (o = R(R({}, o), a.getChildContext())), y && !d && a.getSnapshotBeforeUpdate != null && (i = a.getSnapshotBeforeUpdate(v, w)), u = Ke(e, _e(k = g != null && g.type === F && g.key == null ? g.props.children : g) ? k : [k], t, n, o, _, r, c, u, f, l), a.base = t.__e, t.__u &= -161, a.__h.length && c.push(a), p && (a.__E = a.__ = null);
  } catch (L) {
    if (t.__v = null, f || r != null) if (L.then) {
      for (t.__u |= f ? 160 : 128; u && u.nodeType == 8 && u.nextSibling; ) u = u.nextSibling;
      r[r.indexOf(u)] = null, t.__e = u;
    } else for (x = r.length; x--; ) ge(r[x]);
    else t.__e = n.__e, t.__k = n.__k;
    h.__e(L, t, n);
  }
  else r == null && t.__v == n.__v ? (t.__k = n.__k, t.__e = n.__e) : u = t.__e = yt(n.__e, t, n, o, _, r, c, f, l);
  return (g = h.diffed) && g(t), 128 & t.__u ? void 0 : u;
}
function Ze(e, t, n) {
  for (var o = 0; o < n.length; o++) we(n[o], n[++o], n[++o]);
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
function yt(e, t, n, o, _, r, c, u, f) {
  var l, g, a, d, v, w, i, p = n.props, s = t.props, y = t.type;
  if (y == "svg" ? _ = "http://www.w3.org/2000/svg" : y == "math" ? _ = "http://www.w3.org/1998/Math/MathML" : _ || (_ = "http://www.w3.org/1999/xhtml"), r != null) {
    for (l = 0; l < r.length; l++) if ((v = r[l]) && "setAttribute" in v == !!y && (y ? v.localName == y : v.nodeType == 3)) {
      e = v, r[l] = null;
      break;
    }
  }
  if (e == null) {
    if (y == null) return document.createTextNode(s);
    e = document.createElementNS(_, y, s.is && s), u && (h.__m && h.__m(t, r), u = !1), r = null;
  }
  if (y === null) p === s || u && e.data === s || (e.data = s);
  else {
    if (r = r && Q.call(e.childNodes), p = n.props || X, !u && r != null) for (p = {}, l = 0; l < e.attributes.length; l++) p[(v = e.attributes[l]).name] = v.value;
    for (l in p) if (v = p[l], l != "children") {
      if (l == "dangerouslySetInnerHTML") a = v;
      else if (!(l in s)) {
        if (l == "value" && "defaultValue" in s || l == "checked" && "defaultChecked" in s) continue;
        V(e, l, null, v, _);
      }
    }
    for (l in s) v = s[l], l == "children" ? d = v : l == "dangerouslySetInnerHTML" ? g = v : l == "value" ? w = v : l == "checked" ? i = v : u && typeof v != "function" || p[l] === v || V(e, l, v, p[l], _);
    if (g) u || a && (g.__html === a.__html || g.__html === e.innerHTML) || (e.innerHTML = g.__html), t.__k = [];
    else if (a && (e.innerHTML = ""), Ke(e, _e(d) ? d : [d], t, n, o, y == "foreignObject" ? "http://www.w3.org/1999/xhtml" : _, r, c, r ? r[0] : n.__k && Y(n, 0), u, f), r != null) for (l = r.length; l--; ) ge(r[l]);
    u || (l = "value", y == "progress" && w == null ? e.removeAttribute("value") : w !== void 0 && (w !== e[l] || y == "progress" && !w || y == "option" && w !== p[l]) && V(e, l, w, p[l], _), l = "checked", i !== void 0 && i !== e[l] && V(e, l, i, p[l], _));
  }
  return e;
}
function we(e, t, n) {
  try {
    if (typeof e == "function") {
      var o = typeof e.__u == "function";
      o && e.__u(), o && t == null || (e.__u = e(t));
    } else e.current = t;
  } catch (_) {
    h.__e(_, n);
  }
}
function Ve(e, t, n) {
  var o, _;
  if (h.unmount && h.unmount(e), (o = e.ref) && (o.current && o.current !== e.__e || we(o, null, t)), (o = e.__c) != null) {
    if (o.componentWillUnmount) try {
      o.componentWillUnmount();
    } catch (r) {
      h.__e(r, t);
    }
    o.base = o.__P = null;
  }
  if (o = e.__k) for (_ = 0; _ < o.length; _++) o[_] && Ve(o[_], t, n || typeof e.type != "function");
  n || ge(e.__e), e.__c = e.__ = e.__e = void 0;
}
function mt(e, t, n) {
  return this.constructor(e, n);
}
function et(e, t, n) {
  var o, _, r, c;
  t == document && (t = document.documentElement), h.__ && h.__(e, t), _ = (o = typeof n == "function") ? null : n && n.__k || t.__k, r = [], c = [], be(t, e = (!o && n || t).__k = A(F, null, [e]), _ || X, X, t.namespaceURI, !o && n ? [n] : _ ? null : t.firstChild ? Q.call(t.childNodes) : null, r, !o && n ? n : _ ? _.__e : t.firstChild, o, c), Ze(r, e, c);
}
function tt(e, t) {
  et(e, t, tt);
}
function Ce(e, t, n) {
  var o, _, r, c, u = R({}, e.props);
  for (r in e.type && e.type.defaultProps && (c = e.type.defaultProps), t) r == "key" ? o = t[r] : r == "ref" ? _ = t[r] : u[r] = t[r] === void 0 && c !== void 0 ? c[r] : t[r];
  return arguments.length > 2 && (u.children = arguments.length > 3 ? Q.call(arguments, 2) : n), G(e.type, u, o || e.key, _ || e.ref, null);
}
function nt(e, t) {
  var n = { __c: t = "__cC" + qe++, __: e, Consumer: function(o, _) {
    return o.children(_);
  }, Provider: function(o) {
    var _, r;
    return this.getChildContext || (_ = /* @__PURE__ */ new Set(), (r = {})[t] = this, this.getChildContext = function() {
      return r;
    }, this.componentWillUnmount = function() {
      _ = null;
    }, this.shouldComponentUpdate = function(c) {
      this.props.value !== c.value && _.forEach(function(u) {
        u.__e = !0, de(u);
      });
    }, this.sub = function(c) {
      _.add(c);
      var u = c.componentWillUnmount;
      c.componentWillUnmount = function() {
        _ && _.delete(c), u && u.call(c);
      };
    }), o.children;
  } };
  return n.Provider.__ = n.Consumer.contextType = n;
}
Q = Je.slice, h = { __e: function(e, t, n, o) {
  for (var _, r, c; t = t.__; ) if ((_ = t.__c) && !_.__) try {
    if ((r = _.constructor) && r.getDerivedStateFromError != null && (_.setState(r.getDerivedStateFromError(e)), c = _.__d), _.componentDidCatch != null && (_.componentDidCatch(e, o || {}), c = _.__d), c) return _.__E = _;
  } catch (u) {
    e = u;
  }
  throw e;
} }, ze = 0, N.prototype.setState = function(e, t) {
  var n;
  n = this.__s != null && this.__s !== this.state ? this.__s : this.__s = R({}, this.state), typeof e == "function" && (e = e(R({}, n), this.props)), e && R(n, e), e != null && this.__v && (t && this._sb.push(t), de(this));
}, N.prototype.forceUpdate = function(e) {
  this.__v && (this.__e = !0, e && this.__h.push(e), de(this));
}, N.prototype.render = F, j = [], Be = typeof Promise == "function" ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout, fe = function(e, t) {
  return e.__v.__b - t.__v.__b;
}, oe.__r = 0, Ye = /(PointerCapture)$|Capture$/i, me = 0, pe = Se(!1), he = Se(!0), qe = 0;
var gt = 0;
function B(e, t, n, o, _, r) {
  t || (t = {});
  var c, u, f = t;
  if ("ref" in f) for (u in f = {}, t) u == "ref" ? c = t[u] : f[u] = t[u];
  var l = { type: e, props: f, key: n, ref: c, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: --gt, __i: -1, __u: 0, __source: _, __self: r };
  if (typeof e == "function" && (c = e.defaultProps)) for (u in c) f[u] === void 0 && (f[u] = c[u]);
  return h.vnode && h.vnode(l), l;
}
var q, T, ae, xe, re = 0, ot = [], S = h, Pe = S.__b, He = S.__r, Ue = S.diffed, De = S.__c, Le = S.unmount, Oe = S.__;
function ie(e, t) {
  S.__h && S.__h(T, e, re || t), re = 0;
  var n = T.__H || (T.__H = { __: [], __h: [] });
  return e >= n.__.length && n.__.push({}), n.__[e];
}
function bt(e) {
  return re = 1, ke(at, e);
}
function ke(e, t, n) {
  var o = ie(q++, 2);
  if (o.t = e, !o.__c && (o.__ = [at(void 0, t), function(u) {
    var f = o.__N ? o.__N[0] : o.__[0], l = o.t(f, u);
    f !== l && (o.__N = [l, o.__[1]], o.__c.setState({}));
  }], o.__c = T, !T.u)) {
    var _ = function(u, f, l) {
      if (!o.__c.__H) return !0;
      var g = o.__c.__H.__.filter(function(d) {
        return !!d.__c;
      });
      if (g.every(function(d) {
        return !d.__N;
      })) return !r || r.call(this, u, f, l);
      var a = o.__c.props !== u;
      return g.forEach(function(d) {
        if (d.__N) {
          var v = d.__[0];
          d.__ = d.__N, d.__N = void 0, v !== d.__[0] && (a = !0);
        }
      }), r && r.call(this, u, f, l) || a;
    };
    T.u = !0;
    var r = T.shouldComponentUpdate, c = T.componentWillUpdate;
    T.componentWillUpdate = function(u, f, l) {
      if (this.__e) {
        var g = r;
        r = void 0, _(u, f, l), r = g;
      }
      c && c.call(this, u, f, l);
    }, T.shouldComponentUpdate = _;
  }
  return o.__N || o.__;
}
function rt(e, t) {
  var n = ie(q++, 4);
  !S.__s && it(n.__H, t) && (n.__ = e, n.i = t, T.__h.push(n));
}
function O(e) {
  return re = 5, Ee(function() {
    return { current: e };
  }, []);
}
function Ee(e, t) {
  var n = ie(q++, 7);
  return it(n.__H, t) && (n.__ = e(), n.__H = t, n.__h = e), n.__;
}
function _t(e) {
  var t = T.context[e.__c], n = ie(q++, 9);
  return n.c = e, t ? (n.__ == null && (n.__ = !0, t.sub(T)), t.props.value) : e.__;
}
function wt() {
  for (var e; e = ot.shift(); ) if (e.__P && e.__H) try {
    e.__H.__h.forEach(ne), e.__H.__h.forEach(ve), e.__H.__h = [];
  } catch (t) {
    e.__H.__h = [], S.__e(t, e.__v);
  }
}
S.__b = function(e) {
  T = null, Pe && Pe(e);
}, S.__ = function(e, t) {
  e && t.__k && t.__k.__m && (e.__m = t.__k.__m), Oe && Oe(e, t);
}, S.__r = function(e) {
  He && He(e), q = 0;
  var t = (T = e.__c).__H;
  t && (ae === T ? (t.__h = [], T.__h = [], t.__.forEach(function(n) {
    n.__N && (n.__ = n.__N), n.i = n.__N = void 0;
  })) : (t.__h.forEach(ne), t.__h.forEach(ve), t.__h = [], q = 0)), ae = T;
}, S.diffed = function(e) {
  Ue && Ue(e);
  var t = e.__c;
  t && t.__H && (t.__H.__h.length && (ot.push(t) !== 1 && xe === S.requestAnimationFrame || ((xe = S.requestAnimationFrame) || kt)(wt)), t.__H.__.forEach(function(n) {
    n.i && (n.__H = n.i), n.i = void 0;
  })), ae = T = null;
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
  }), De && De(e, t);
}, S.unmount = function(e) {
  Le && Le(e);
  var t, n = e.__c;
  n && n.__H && (n.__H.__.forEach(function(o) {
    try {
      ne(o);
    } catch (_) {
      t = _;
    }
  }), n.__H = void 0, t && S.__e(t, n.__v));
};
var Me = typeof requestAnimationFrame == "function";
function kt(e) {
  var t, n = function() {
    clearTimeout(o), Me && cancelAnimationFrame(t), setTimeout(e);
  }, o = setTimeout(n, 100);
  Me && (t = requestAnimationFrame(n));
}
function ne(e) {
  var t = T, n = e.__c;
  typeof n == "function" && (e.__c = void 0, n()), T = t;
}
function ve(e) {
  var t = T;
  e.__c = e.__(), T = t;
}
function it(e, t) {
  return !e || e.length !== t.length || t.some(function(n, o) {
    return n !== e[o];
  });
}
function at(e, t) {
  return typeof t == "function" ? t(e) : t;
}
let I, J;
const Et = (e, t) => {
  if (I = void 0, t && t.type === "click") {
    if (t.ctrlKey || t.metaKey || t.altKey || t.shiftKey || t.button !== 0)
      return e;
    const n = t.target.closest("a[href]"), o = n && n.getAttribute("href");
    if (!n || n.origin != location.origin || /^#/.test(o) || !/^(_?self)?$/i.test(n.target) || J && (typeof J == "string" ? !o.startsWith(J) : !J.test(o)))
      return e;
    I = !0, t.preventDefault(), t = n.href.replace(location.origin, "");
  } else typeof t == "string" ? I = !0 : t && t.url ? (I = !t.replace, t = t.url) : t = location.pathname + location.search;
  return I === !0 ? history.pushState(null, "", t) : I === !1 && history.replaceState(null, "", t), t;
}, $t = (e, t, n = {}) => {
  e = e.split("/").filter(Boolean), t = (t || "").split("/").filter(Boolean), n.params || (n.params = {});
  for (let o = 0, _, r; o < Math.max(e.length, t.length); o++) {
    let [, c, u, f] = (t[o] || "").match(/^(:?)(.*?)([+*?]?)$/);
    if (_ = e[o], !(!c && u == _)) {
      if (!c && _ && f == "*") {
        n.rest = "/" + e.slice(o).map(decodeURIComponent).join("/");
        break;
      }
      if (!c || !_ && f != "?" && f != "*") return;
      if (r = f == "+" || f == "*", r ? _ = e.slice(o).map(decodeURIComponent).join("/") || void 0 : _ && (_ = decodeURIComponent(_)), n.params[u] = _, u in n || (n[u] = _), r) break;
    }
  }
  return n;
};
function Z(e) {
  const [t, n] = ke(Et, e.url || location.pathname + location.search);
  e.scope && (J = e.scope);
  const o = I === !0, _ = Ee(() => {
    const r = new URL(t, location.origin), c = r.pathname.replace(/\/+$/g, "") || "/";
    return {
      url: t,
      path: c,
      query: Object.fromEntries(r.searchParams),
      route: (u, f) => n({ url: u, replace: f }),
      wasPush: o
    };
  }, [t]);
  return rt(() => (addEventListener("click", n), addEventListener("popstate", n), () => {
    removeEventListener("click", n), removeEventListener("popstate", n);
  }), []), A(Z.ctx.Provider, { value: _ }, e.children);
}
const Tt = Promise.resolve();
function ct(e) {
  const [t, n] = ke((k) => k + 1, 0), { url: o, query: _, wasPush: r, path: c } = St(), { rest: u = c, params: f = {} } = _t(Re), l = O(!1), g = O(c), a = O(0), d = (
    /** @type {RefObject<VNode<any>>} */
    O()
  ), v = (
    /** @type {RefObject<VNode<any>>} */
    O()
  ), w = (
    /** @type {RefObject<Element | Text>} */
    O()
  ), i = O(!1), p = (
    /** @type {RefObject<boolean>} */
    O()
  );
  p.current = !1;
  const s = O(!1);
  let y, b, m;
  Qe(e.children).some((k) => {
    if ($t(u, k.props.path, m = { ...k.props, path: u, query: _, params: f, rest: "" })) return y = Ce(k, m);
    k.props.default && (b = Ce(k, m));
  });
  let E = y || b;
  Ee(() => {
    v.current = d.current;
    const k = v.current && v.current.props.children;
    !k || !E || E.type !== k.type || E.props.component !== k.props.component ? (this.__v && this.__v.__k && this.__v.__k.reverse(), a.current++, s.current = !0) : s.current = !1;
  }, [o]);
  const P = d.current && d.current.__u & ee && d.current.__u & te, H = d.current && d.current.__h;
  d.current = /** @type {VNode<any>} */
  A(Re.Provider, { value: m }, E), P ? (d.current.__u |= ee, d.current.__u |= te) : H && (d.current.__h = !0);
  const U = v.current;
  return v.current = null, this.__c = (k, x) => {
    p.current = !0, v.current = U, e.onLoadStart && e.onLoadStart(o), l.current = !0;
    let $ = a.current;
    k.then(() => {
      $ === a.current && (v.current = null, d.current && (x.__h && (d.current.__h = x.__h), x.__u & te && (d.current.__u |= te), x.__u & ee && (d.current.__u |= ee)), Tt.then(n));
    });
  }, rt(() => {
    const k = this.__v && this.__v.__e;
    if (p.current) {
      !i.current && !w.current && (w.current = k);
      return;
    }
    !i.current && w.current && (w.current !== k && w.current.remove(), w.current = null), i.current = !0, g.current !== c && (r && scrollTo(0, 0), e.onRouteChange && e.onRouteChange(o), g.current = c), e.onLoadEnd && l.current && e.onLoadEnd(o), l.current = !1;
  }, [c, r, t]), s.current ? [A(ce, { r: d }), A(ce, { r: v })] : A(ce, { r: d });
}
const ee = 32, te = 128, ce = ({ r: e }) => e.current;
ct.Provider = Z;
Z.ctx = nt(
  /** @type {import('./router.d.ts').LocationHook & { wasPush: boolean }} */
  {}
);
const Re = nt(
  /** @type {import('./router.d.ts').RouteHook & { rest: string }} */
  {}
), Ne = (e) => A(e.component, e), St = () => _t(Z.ctx), Ae = h.__b;
h.__b = (e) => {
  e.type && e.type._forwarded && e.ref && (e.props.ref = e.ref, e.ref = null), Ae && Ae(e);
};
function ut(e) {
  let t, n;
  const o = () => e().then((r) => n = r && r.default || r), _ = (r) => {
    const [, c] = bt(0), u = O(n);
    if (t || (t = o()), n !== void 0) return A(n, r);
    throw u.current || (u.current = t.then(() => c(1))), t;
  };
  return _.preload = () => (t || (t = o()), t), _._forwarded = !0, _;
}
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
let je;
function Ct(e, t) {
  if (typeof window > "u") return;
  let n = document.querySelector("script[type=isodata]");
  t = t || n && n.parentNode || document.body, !je && n ? tt(e, t) : et(e, t), je = !0;
}
var ue;
(ue = typeof globalThis < "u" ? globalThis : typeof window < "u" ? window : void 0) != null && ue.__PREACT_DEVTOOLS__ && ue.__PREACT_DEVTOOLS__.attachPreact("10.25.4", h, { Fragment: F, Component: N });
var Fe = {};
function M(e) {
  return e.type === F ? "Fragment" : typeof e.type == "function" ? e.type.displayName || e.type.name : typeof e.type == "string" ? e.type : "#text";
}
var K = [], z = [];
function st() {
  return K.length > 0 ? K[K.length - 1] : null;
}
var We = !0;
function se(e) {
  return typeof e.type == "function" && e.type != F;
}
function C(e) {
  for (var t = [e], n = e; n.__o != null; ) t.push(n.__o), n = n.__o;
  return t.reduce(function(o, _) {
    o += "  in " + M(_);
    var r = _.__source;
    return r ? o += " (at " + r.fileName + ":" + r.lineNumber + ")" : We && console.warn("Add @babel/plugin-transform-react-jsx-source to get a more detailed component stack. Note that you should not add it to production builds of your App for bundle size reasons."), We = !1, o + `
`;
  }, "");
}
var xt = typeof WeakMap == "function";
function ye(e) {
  var t = [];
  return e.__k && e.__k.forEach(function(n) {
    n && typeof n.type == "function" ? t.push.apply(t, ye(n)) : n && typeof n.type == "string" && t.push(n.type);
  }), t;
}
function lt(e) {
  return e ? typeof e.type == "function" ? e.__ == null ? e.__e != null && e.__e.parentNode != null ? e.__e.parentNode.localName : "" : lt(e.__) : e.type : "";
}
var Pt = N.prototype.setState;
function le(e) {
  return e === "table" || e === "tfoot" || e === "tbody" || e === "thead" || e === "td" || e === "tr" || e === "th";
}
N.prototype.setState = function(e, t) {
  return this.__v == null && this.state == null && console.warn(`Calling "this.setState" inside the constructor of a component is a no-op and might be a bug in your application. Instead, set "this.state = {}" directly.

` + C(st())), Pt.call(this, e, t);
};
var Ht = /^(address|article|aside|blockquote|details|div|dl|fieldset|figcaption|figure|footer|form|h1|h2|h3|h4|h5|h6|header|hgroup|hr|main|menu|nav|ol|p|pre|search|section|table|ul)$/, Ut = N.prototype.forceUpdate;
function D(e) {
  var t = e.props, n = M(e), o = "";
  for (var _ in t) if (t.hasOwnProperty(_) && _ !== "children") {
    var r = t[_];
    typeof r == "function" && (r = "function " + (r.displayName || r.name) + "() {}"), r = Object(r) !== r || r.toString ? r + "" : Object.prototype.toString.call(r), o += " " + _ + "=" + JSON.stringify(r);
  }
  var c = t.children;
  return "<" + n + o + (c && c.length ? ">..</" + n + ">" : " />");
}
N.prototype.forceUpdate = function(e) {
  return this.__v == null ? console.warn(`Calling "this.forceUpdate" inside the constructor of a component is a no-op and might be a bug in your application.

` + C(st())) : this.__P == null && console.warn(`Can't call "this.forceUpdate" on an unmounted component. This is a no-op, but it indicates a memory leak in your application. To fix, cancel all subscriptions and asynchronous tasks in the componentWillUnmount method.

` + C(this.__v)), Ut.call(this, e);
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
      se(m) && z.pop(), K.pop(), p && p(m);
    }, h.__b = function(m) {
      se(m) && K.push(m), i && i(m);
    }, h.__ = function(m, E) {
      z = [], s && s(m, E);
    }, h.vnode = function(m) {
      m.__o = z.length > 0 ? z[z.length - 1] : null, y && y(m);
    }, h.__r = function(m) {
      se(m) && z.push(m), b && b(m);
    };
  })();
  var e = !1, t = h.__b, n = h.diffed, o = h.vnode, _ = h.__r, r = h.__e, c = h.__, u = h.__h, f = xt ? { lazyPropTypes: /* @__PURE__ */ new WeakMap() } : null, l = [];
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

You likely forgot to export your component or might have mixed up default and named imports` + D(i) + `

` + C(i));
    if (p != null && typeof p == "object")
      throw p.__k !== void 0 && p.__e !== void 0 ? new Error("Invalid type passed to createElement(): " + p + `

Did you accidentally pass a JSX literal as JSX twice?

  let My` + M(i) + " = " + D(p) + `;
  let vnode = <My` + M(i) + ` />;

This usually happens when you export a JSX literal and not the component.

` + C(i)) : new Error("Invalid type passed to createElement(): " + (Array.isArray(p) ? "array" : p));
    if (i.ref !== void 0 && typeof i.ref != "function" && typeof i.ref != "object" && !("$$typeof" in i)) throw new Error(`Component's "ref" property should be a function, or an object created by createRef(), but got [` + typeof i.ref + `] instead
` + D(i) + `

` + C(i));
    if (typeof i.type == "string") {
      for (var s in i.props) if (s[0] === "o" && s[1] === "n" && typeof i.props[s] != "function" && i.props[s] != null) throw new Error(`Component's "` + s + '" property should be a function, but got [' + typeof i.props[s] + `] instead
` + D(i) + `

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
        for (var H in P) E[H] = P[H];
        return E;
      }({}, m)).ref, function(E, P, H, U, k) {
        Object.keys(E).forEach(function(x) {
          var $;
          try {
            $ = E[x](P, x, U, "prop", null, "SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED");
          } catch (L) {
            $ = L;
          }
          $ && !($.message in Fe) && (Fe[$.message] = !0, console.error("Failed prop type: " + $.message + (k && `
` + k() || "")));
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
    u && u(i, p, s);
  };
  var d = function(i, p) {
    return { get: function() {
      var s = "get" + i + p;
      l && l.indexOf(s) < 0 && (l.push(s), console.warn("getting vnode." + i + " is deprecated, " + p));
    }, set: function() {
      var s = "set" + i + p;
      l && l.indexOf(s) < 0 && (l.push(s), console.warn("setting vnode." + i + " is not allowed, " + p));
    } };
  }, v = { nodeName: d("nodeName", "use vnode.type"), attributes: d("attributes", "use vnode.props"), children: d("children", "use vnode.props.children") }, w = Object.create({}, v);
  h.vnode = function(i) {
    var p = i.props;
    if (i.type !== null && p != null && ("__source" in p || "__self" in p)) {
      var s = i.props = {};
      for (var y in p) {
        var b = p[y];
        y === "__source" ? i.__source = b : y === "__self" ? i.__self = b : s[y] = b;
      }
    }
    i.__proto__ = w, o && o(i);
  }, h.diffed = function(i) {
    var p, s = i.type, y = i.__;
    if (i.__k && i.__k.forEach(function(W) {
      if (typeof W == "object" && W && W.type === void 0) {
        var pt = Object.keys(W).join(",");
        throw new Error("Objects are not valid as a child. Encountered an object with the keys {" + pt + `}.

` + C(i));
      }
    }), i.__c === g && (a = 0), typeof s == "string" && (le(s) || s === "p" || s === "a" || s === "button")) {
      var b = lt(y);
      if (b !== "" && le(s)) s === "table" && b !== "td" && le(b) ? (console.log(b, y.__e), console.error("Improper nesting of table. Your <table> should not have a table-node parent." + D(i) + `

` + C(i))) : s !== "thead" && s !== "tfoot" && s !== "tbody" || b === "table" ? s === "tr" && b !== "thead" && b !== "tfoot" && b !== "tbody" ? console.error("Improper nesting of table. Your <tr> should have a <thead/tbody/tfoot> parent." + D(i) + `

` + C(i)) : s === "td" && b !== "tr" ? console.error("Improper nesting of table. Your <td> should have a <tr> parent." + D(i) + `

` + C(i)) : s === "th" && b !== "tr" && console.error("Improper nesting of table. Your <th> should have a <tr>." + D(i) + `

` + C(i)) : console.error("Improper nesting of table. Your <thead/tbody/tfoot> should have a <table> parent." + D(i) + `

` + C(i));
      else if (s === "p") {
        var m = ye(i).filter(function(W) {
          return Ht.test(W);
        });
        m.length && console.error("Improper nesting of paragraph. Your <p> should not have " + m.join(", ") + " as child-elements." + D(i) + `

` + C(i));
      } else s !== "a" && s !== "button" || ye(i).indexOf(s) !== -1 && console.error("Improper nesting of interactive content. Your <" + s + "> should not have other " + (s === "a" ? "anchor" : "button") + " tags as child-elements." + D(i) + `

` + C(i));
    }
    if (e = !1, n && n(i), i.__k != null) for (var E = [], P = 0; P < i.__k.length; P++) {
      var H = i.__k[P];
      if (H && H.key != null) {
        var U = H.key;
        if (E.indexOf(U) !== -1) {
          console.error('Following component has two or more children with the same key attribute: "' + U + `". This may cause glitches and misbehavior in rendering process. Component: 

` + D(i) + `

` + C(i));
          break;
        }
        E.push(U);
      }
    }
    if (i.__c != null && i.__c.__H != null) {
      var k = i.__c.__H.__;
      if (k) for (var x = 0; x < k.length; x += 1) {
        var $ = k[x];
        if ($.__H) {
          for (var L = 0; L < $.__H.length; L++) if ((p = $.__H[L]) != p) {
            var ft = M(i);
            console.warn("Invalid argument passed to hook. Hooks should not be called with NaN in the dependency array. Hook index " + x + " in component " + ft + " was called with NaN.");
          }
        }
      }
    }
  };
}();
const Nt = ["Good Morning", "Good Evening", "Good Night"], Dt = (e) => /* @__PURE__ */ B(Z, { children: /* @__PURE__ */ B(ct, { children: e.children }) }), Lt = ut(() => import("./home-Du4p-i67.js")), Ot = ut(() => import("./test-Cf_JjTVL.js")), Mt = () => /* @__PURE__ */ B(Dt, { children: [
  /* @__PURE__ */ B(Ne, { path: "/", component: Lt }),
  /* @__PURE__ */ B(Ne, { path: "/test", component: Ot })
] }), Rt = document.getElementById("app");
Ct(/* @__PURE__ */ B(Mt, {}), Rt);
export {
  Mt as A,
  Lt as H,
  Ot as T,
  Nt as m,
  B as u
};
//# sourceMappingURL=client-CkhSJSge.js.map
