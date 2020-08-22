var app = (function () {
    'use strict';

    function noop() { }
    function assign(tar, src) {
        // @ts-ignore
        for (const k in src)
            tar[k] = src[k];
        return tar;
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function create_slot(definition, ctx, $$scope, fn) {
        if (definition) {
            const slot_ctx = get_slot_context(definition, ctx, $$scope, fn);
            return definition[0](slot_ctx);
        }
    }
    function get_slot_context(definition, ctx, $$scope, fn) {
        return definition[1] && fn
            ? assign($$scope.ctx.slice(), definition[1](fn(ctx)))
            : $$scope.ctx;
    }
    function get_slot_changes(definition, $$scope, dirty, fn) {
        if (definition[2] && fn) {
            const lets = definition[2](fn(dirty));
            if ($$scope.dirty === undefined) {
                return lets;
            }
            if (typeof lets === 'object') {
                const merged = [];
                const len = Math.max($$scope.dirty.length, lets.length);
                for (let i = 0; i < len; i += 1) {
                    merged[i] = $$scope.dirty[i] | lets[i];
                }
                return merged;
            }
            return $$scope.dirty | lets;
        }
        return $$scope.dirty;
    }
    function update_slot(slot, slot_definition, ctx, $$scope, dirty, get_slot_changes_fn, get_slot_context_fn) {
        const slot_changes = get_slot_changes(slot_definition, $$scope, dirty, get_slot_changes_fn);
        if (slot_changes) {
            const slot_context = get_slot_context(slot_definition, ctx, $$scope, get_slot_context_fn);
            slot.p(slot_context, slot_changes);
        }
    }
    function exclude_internal_props(props) {
        const result = {};
        for (const k in props)
            if (k[0] !== '$')
                result[k] = props[k];
        return result;
    }
    function compute_rest_props(props, keys) {
        const rest = {};
        keys = new Set(keys);
        for (const k in props)
            if (!keys.has(k) && k[0] !== '$')
                rest[k] = props[k];
        return rest;
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function set_attributes(node, attributes) {
        // @ts-ignore
        const descriptors = Object.getOwnPropertyDescriptors(node.__proto__);
        for (const key in attributes) {
            if (attributes[key] == null) {
                node.removeAttribute(key);
            }
            else if (key === 'style') {
                node.style.cssText = attributes[key];
            }
            else if (key === '__value') {
                node.value = node[key] = attributes[key];
            }
            else if (descriptors[key] && descriptors[key].set) {
                node[key] = attributes[key];
            }
            else {
                attr(node, key, attributes[key]);
            }
        }
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_style(node, key, value, important) {
        node.style.setProperty(key, value, important ? 'important' : '');
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error(`Function called outside component initialization`);
        return current_component;
    }
    function onMount(fn) {
        get_current_component().$$.on_mount.push(fn);
    }
    function afterUpdate(fn) {
        get_current_component().$$.after_update.push(fn);
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function tick() {
        schedule_update();
        return resolved_promise;
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }

    function get_spread_update(levels, updates) {
        const update = {};
        const to_null_out = {};
        const accounted_for = { $$scope: 1 };
        let i = levels.length;
        while (i--) {
            const o = levels[i];
            const n = updates[i];
            if (n) {
                for (const key in o) {
                    if (!(key in n))
                        to_null_out[key] = 1;
                }
                for (const key in n) {
                    if (!accounted_for[key]) {
                        update[key] = n[key];
                        accounted_for[key] = 1;
                    }
                }
                levels[i] = n;
            }
            else {
                for (const key in o) {
                    accounted_for[key] = 1;
                }
            }
        }
        for (const key in to_null_out) {
            if (!(key in update))
                update[key] = undefined;
        }
        return update;
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const prop_values = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, prop_values, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

    function createCommonjsModule(fn, basedir, module) {
    	return module = {
    	  path: basedir,
    	  exports: {},
    	  require: function (path, base) {
          return commonjsRequire(path, (base === undefined || base === null) ? module.path : base);
        }
    	}, fn(module, module.exports), module.exports;
    }

    function commonjsRequire () {
    	throw new Error('Dynamic requires are not currently supported by @rollup/plugin-commonjs');
    }

    var prism = createCommonjsModule(function (module) {
    /* **********************************************
         Begin prism-core.js
    ********************************************** */

    /// <reference lib="WebWorker"/>

    var _self = (typeof window !== 'undefined')
    	? window   // if in browser
    	: (
    		(typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope)
    		? self // if in worker
    		: {}   // if in node js
    	);

    /**
     * Prism: Lightweight, robust, elegant syntax highlighting
     *
     * @license MIT <https://opensource.org/licenses/MIT>
     * @author Lea Verou <https://lea.verou.me>
     * @namespace
     * @public
     */
    var Prism = (function (_self){

    // Private helper vars
    var lang = /\blang(?:uage)?-([\w-]+)\b/i;
    var uniqueId = 0;


    var _ = {
    	/**
    	 * By default, Prism will attempt to highlight all code elements (by calling {@link Prism.highlightAll}) on the
    	 * current page after the page finished loading. This might be a problem if e.g. you wanted to asynchronously load
    	 * additional languages or plugins yourself.
    	 *
    	 * By setting this value to `true`, Prism will not automatically highlight all code elements on the page.
    	 *
    	 * You obviously have to change this value before the automatic highlighting started. To do this, you can add an
    	 * empty Prism object into the global scope before loading the Prism script like this:
    	 *
    	 * ```js
    	 * window.Prism = window.Prism || {};
    	 * Prism.manual = true;
    	 * // add a new <script> to load Prism's script
    	 * ```
    	 *
    	 * @default false
    	 * @type {boolean}
    	 * @memberof Prism
    	 * @public
    	 */
    	manual: _self.Prism && _self.Prism.manual,
    	disableWorkerMessageHandler: _self.Prism && _self.Prism.disableWorkerMessageHandler,

    	/**
    	 * A namespace for utility methods.
    	 *
    	 * All function in this namespace that are not explicitly marked as _public_ are for __internal use only__ and may
    	 * change or disappear at any time.
    	 *
    	 * @namespace
    	 * @memberof Prism
    	 */
    	util: {
    		encode: function encode(tokens) {
    			if (tokens instanceof Token) {
    				return new Token(tokens.type, encode(tokens.content), tokens.alias);
    			} else if (Array.isArray(tokens)) {
    				return tokens.map(encode);
    			} else {
    				return tokens.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\u00a0/g, ' ');
    			}
    		},

    		/**
    		 * Returns the name of the type of the given value.
    		 *
    		 * @param {any} o
    		 * @returns {string}
    		 * @example
    		 * type(null)      === 'Null'
    		 * type(undefined) === 'Undefined'
    		 * type(123)       === 'Number'
    		 * type('foo')     === 'String'
    		 * type(true)      === 'Boolean'
    		 * type([1, 2])    === 'Array'
    		 * type({})        === 'Object'
    		 * type(String)    === 'Function'
    		 * type(/abc+/)    === 'RegExp'
    		 */
    		type: function (o) {
    			return Object.prototype.toString.call(o).slice(8, -1);
    		},

    		/**
    		 * Returns a unique number for the given object. Later calls will still return the same number.
    		 *
    		 * @param {Object} obj
    		 * @returns {number}
    		 */
    		objId: function (obj) {
    			if (!obj['__id']) {
    				Object.defineProperty(obj, '__id', { value: ++uniqueId });
    			}
    			return obj['__id'];
    		},

    		/**
    		 * Creates a deep clone of the given object.
    		 *
    		 * The main intended use of this function is to clone language definitions.
    		 *
    		 * @param {T} o
    		 * @param {Record<number, any>} [visited]
    		 * @returns {T}
    		 * @template T
    		 */
    		clone: function deepClone(o, visited) {
    			visited = visited || {};

    			var clone, id;
    			switch (_.util.type(o)) {
    				case 'Object':
    					id = _.util.objId(o);
    					if (visited[id]) {
    						return visited[id];
    					}
    					clone = /** @type {Record<string, any>} */ ({});
    					visited[id] = clone;

    					for (var key in o) {
    						if (o.hasOwnProperty(key)) {
    							clone[key] = deepClone(o[key], visited);
    						}
    					}

    					return /** @type {any} */ (clone);

    				case 'Array':
    					id = _.util.objId(o);
    					if (visited[id]) {
    						return visited[id];
    					}
    					clone = [];
    					visited[id] = clone;

    					(/** @type {Array} */(/** @type {any} */(o))).forEach(function (v, i) {
    						clone[i] = deepClone(v, visited);
    					});

    					return /** @type {any} */ (clone);

    				default:
    					return o;
    			}
    		},

    		/**
    		 * Returns the Prism language of the given element set by a `language-xxxx` or `lang-xxxx` class.
    		 *
    		 * If no language is set for the element or the element is `null` or `undefined`, `none` will be returned.
    		 *
    		 * @param {Element} element
    		 * @returns {string}
    		 */
    		getLanguage: function (element) {
    			while (element && !lang.test(element.className)) {
    				element = element.parentElement;
    			}
    			if (element) {
    				return (element.className.match(lang) || [, 'none'])[1].toLowerCase();
    			}
    			return 'none';
    		},

    		/**
    		 * Returns the script element that is currently executing.
    		 *
    		 * This does __not__ work for line script element.
    		 *
    		 * @returns {HTMLScriptElement | null}
    		 */
    		currentScript: function () {
    			if (typeof document === 'undefined') {
    				return null;
    			}
    			if ('currentScript' in document && 1 < 2 /* hack to trip TS' flow analysis */) {
    				return /** @type {any} */ (document.currentScript);
    			}

    			// IE11 workaround
    			// we'll get the src of the current script by parsing IE11's error stack trace
    			// this will not work for inline scripts

    			try {
    				throw new Error();
    			} catch (err) {
    				// Get file src url from stack. Specifically works with the format of stack traces in IE.
    				// A stack will look like this:
    				//
    				// Error
    				//    at _.util.currentScript (http://localhost/components/prism-core.js:119:5)
    				//    at Global code (http://localhost/components/prism-core.js:606:1)

    				var src = (/at [^(\r\n]*\((.*):.+:.+\)$/i.exec(err.stack) || [])[1];
    				if (src) {
    					var scripts = document.getElementsByTagName('script');
    					for (var i in scripts) {
    						if (scripts[i].src == src) {
    							return scripts[i];
    						}
    					}
    				}
    				return null;
    			}
    		},

    		/**
    		 * Returns whether a given class is active for `element`.
    		 *
    		 * The class can be activated if `element` or one of its ancestors has the given class and it can be deactivated
    		 * if `element` or one of its ancestors has the negated version of the given class. The _negated version_ of the
    		 * given class is just the given class with a `no-` prefix.
    		 *
    		 * Whether the class is active is determined by the closest ancestor of `element` (where `element` itself is
    		 * closest ancestor) that has the given class or the negated version of it. If neither `element` nor any of its
    		 * ancestors have the given class or the negated version of it, then the default activation will be returned.
    		 *
    		 * In the paradoxical situation where the closest ancestor contains __both__ the given class and the negated
    		 * version of it, the class is considered active.
    		 *
    		 * @param {Element} element
    		 * @param {string} className
    		 * @param {boolean} [defaultActivation=false]
    		 * @returns {boolean}
    		 */
    		isActive: function (element, className, defaultActivation) {
    			var no = 'no-' + className;

    			while (element) {
    				var classList = element.classList;
    				if (classList.contains(className)) {
    					return true;
    				}
    				if (classList.contains(no)) {
    					return false;
    				}
    				element = element.parentElement;
    			}
    			return !!defaultActivation;
    		}
    	},

    	/**
    	 * This namespace contains all currently loaded languages and the some helper functions to create and modify languages.
    	 *
    	 * @namespace
    	 * @memberof Prism
    	 * @public
    	 */
    	languages: {
    		/**
    		 * Creates a deep copy of the language with the given id and appends the given tokens.
    		 *
    		 * If a token in `redef` also appears in the copied language, then the existing token in the copied language
    		 * will be overwritten at its original position.
    		 *
    		 * ## Best practices
    		 *
    		 * Since the position of overwriting tokens (token in `redef` that overwrite tokens in the copied language)
    		 * doesn't matter, they can technically be in any order. However, this can be confusing to others that trying to
    		 * understand the language definition because, normally, the order of tokens matters in Prism grammars.
    		 *
    		 * Therefore, it is encouraged to order overwriting tokens according to the positions of the overwritten tokens.
    		 * Furthermore, all non-overwriting tokens should be placed after the overwriting ones.
    		 *
    		 * @param {string} id The id of the language to extend. This has to be a key in `Prism.languages`.
    		 * @param {Grammar} redef The new tokens to append.
    		 * @returns {Grammar} The new language created.
    		 * @public
    		 * @example
    		 * Prism.languages['css-with-colors'] = Prism.languages.extend('css', {
    		 *     // Prism.languages.css already has a 'comment' token, so this token will overwrite CSS' 'comment' token
    		 *     // at its original position
    		 *     'comment': { ... },
    		 *     // CSS doesn't have a 'color' token, so this token will be appended
    		 *     'color': /\b(?:red|green|blue)\b/
    		 * });
    		 */
    		extend: function (id, redef) {
    			var lang = _.util.clone(_.languages[id]);

    			for (var key in redef) {
    				lang[key] = redef[key];
    			}

    			return lang;
    		},

    		/**
    		 * Inserts tokens _before_ another token in a language definition or any other grammar.
    		 *
    		 * ## Usage
    		 *
    		 * This helper method makes it easy to modify existing languages. For example, the CSS language definition
    		 * not only defines CSS highlighting for CSS documents, but also needs to define highlighting for CSS embedded
    		 * in HTML through `<style>` elements. To do this, it needs to modify `Prism.languages.markup` and add the
    		 * appropriate tokens. However, `Prism.languages.markup` is a regular JavaScript object literal, so if you do
    		 * this:
    		 *
    		 * ```js
    		 * Prism.languages.markup.style = {
    		 *     // token
    		 * };
    		 * ```
    		 *
    		 * then the `style` token will be added (and processed) at the end. `insertBefore` allows you to insert tokens
    		 * before existing tokens. For the CSS example above, you would use it like this:
    		 *
    		 * ```js
    		 * Prism.languages.insertBefore('markup', 'cdata', {
    		 *     'style': {
    		 *         // token
    		 *     }
    		 * });
    		 * ```
    		 *
    		 * ## Special cases
    		 *
    		 * If the grammars of `inside` and `insert` have tokens with the same name, the tokens in `inside`'s grammar
    		 * will be ignored.
    		 *
    		 * This behavior can be used to insert tokens after `before`:
    		 *
    		 * ```js
    		 * Prism.languages.insertBefore('markup', 'comment', {
    		 *     'comment': Prism.languages.markup.comment,
    		 *     // tokens after 'comment'
    		 * });
    		 * ```
    		 *
    		 * ## Limitations
    		 *
    		 * The main problem `insertBefore` has to solve is iteration order. Since ES2015, the iteration order for object
    		 * properties is guaranteed to be the insertion order (except for integer keys) but some browsers behave
    		 * differently when keys are deleted and re-inserted. So `insertBefore` can't be implemented by temporarily
    		 * deleting properties which is necessary to insert at arbitrary positions.
    		 *
    		 * To solve this problem, `insertBefore` doesn't actually insert the given tokens into the target object.
    		 * Instead, it will create a new object and replace all references to the target object with the new one. This
    		 * can be done without temporarily deleting properties, so the iteration order is well-defined.
    		 *
    		 * However, only references that can be reached from `Prism.languages` or `insert` will be replaced. I.e. if
    		 * you hold the target object in a variable, then the value of the variable will not change.
    		 *
    		 * ```js
    		 * var oldMarkup = Prism.languages.markup;
    		 * var newMarkup = Prism.languages.insertBefore('markup', 'comment', { ... });
    		 *
    		 * assert(oldMarkup !== Prism.languages.markup);
    		 * assert(newMarkup === Prism.languages.markup);
    		 * ```
    		 *
    		 * @param {string} inside The property of `root` (e.g. a language id in `Prism.languages`) that contains the
    		 * object to be modified.
    		 * @param {string} before The key to insert before.
    		 * @param {Grammar} insert An object containing the key-value pairs to be inserted.
    		 * @param {Object<string, any>} [root] The object containing `inside`, i.e. the object that contains the
    		 * object to be modified.
    		 *
    		 * Defaults to `Prism.languages`.
    		 * @returns {Grammar} The new grammar object.
    		 * @public
    		 */
    		insertBefore: function (inside, before, insert, root) {
    			root = root || /** @type {any} */ (_.languages);
    			var grammar = root[inside];
    			/** @type {Grammar} */
    			var ret = {};

    			for (var token in grammar) {
    				if (grammar.hasOwnProperty(token)) {

    					if (token == before) {
    						for (var newToken in insert) {
    							if (insert.hasOwnProperty(newToken)) {
    								ret[newToken] = insert[newToken];
    							}
    						}
    					}

    					// Do not insert token which also occur in insert. See #1525
    					if (!insert.hasOwnProperty(token)) {
    						ret[token] = grammar[token];
    					}
    				}
    			}

    			var old = root[inside];
    			root[inside] = ret;

    			// Update references in other language definitions
    			_.languages.DFS(_.languages, function(key, value) {
    				if (value === old && key != inside) {
    					this[key] = ret;
    				}
    			});

    			return ret;
    		},

    		// Traverse a language definition with Depth First Search
    		DFS: function DFS(o, callback, type, visited) {
    			visited = visited || {};

    			var objId = _.util.objId;

    			for (var i in o) {
    				if (o.hasOwnProperty(i)) {
    					callback.call(o, i, o[i], type || i);

    					var property = o[i],
    					    propertyType = _.util.type(property);

    					if (propertyType === 'Object' && !visited[objId(property)]) {
    						visited[objId(property)] = true;
    						DFS(property, callback, null, visited);
    					}
    					else if (propertyType === 'Array' && !visited[objId(property)]) {
    						visited[objId(property)] = true;
    						DFS(property, callback, i, visited);
    					}
    				}
    			}
    		}
    	},

    	plugins: {},

    	/**
    	 * This is the most high-level function in Prism’s API.
    	 * It fetches all the elements that have a `.language-xxxx` class and then calls {@link Prism.highlightElement} on
    	 * each one of them.
    	 *
    	 * This is equivalent to `Prism.highlightAllUnder(document, async, callback)`.
    	 *
    	 * @param {boolean} [async=false] Same as in {@link Prism.highlightAllUnder}.
    	 * @param {HighlightCallback} [callback] Same as in {@link Prism.highlightAllUnder}.
    	 * @memberof Prism
    	 * @public
    	 */
    	highlightAll: function(async, callback) {
    		_.highlightAllUnder(document, async, callback);
    	},

    	/**
    	 * Fetches all the descendants of `container` that have a `.language-xxxx` class and then calls
    	 * {@link Prism.highlightElement} on each one of them.
    	 *
    	 * The following hooks will be run:
    	 * 1. `before-highlightall`
    	 * 2. All hooks of {@link Prism.highlightElement} for each element.
    	 *
    	 * @param {ParentNode} container The root element, whose descendants that have a `.language-xxxx` class will be highlighted.
    	 * @param {boolean} [async=false] Whether each element is to be highlighted asynchronously using Web Workers.
    	 * @param {HighlightCallback} [callback] An optional callback to be invoked on each element after its highlighting is done.
    	 * @memberof Prism
    	 * @public
    	 */
    	highlightAllUnder: function(container, async, callback) {
    		var env = {
    			callback: callback,
    			container: container,
    			selector: 'code[class*="language-"], [class*="language-"] code, code[class*="lang-"], [class*="lang-"] code'
    		};

    		_.hooks.run('before-highlightall', env);

    		env.elements = Array.prototype.slice.apply(env.container.querySelectorAll(env.selector));

    		_.hooks.run('before-all-elements-highlight', env);

    		for (var i = 0, element; element = env.elements[i++];) {
    			_.highlightElement(element, async === true, env.callback);
    		}
    	},

    	/**
    	 * Highlights the code inside a single element.
    	 *
    	 * The following hooks will be run:
    	 * 1. `before-sanity-check`
    	 * 2. `before-highlight`
    	 * 3. All hooks of {@link Prism.highlight}. These hooks will only be run by the current worker if `async` is `true`.
    	 * 4. `before-insert`
    	 * 5. `after-highlight`
    	 * 6. `complete`
    	 *
    	 * @param {Element} element The element containing the code.
    	 * It must have a class of `language-xxxx` to be processed, where `xxxx` is a valid language identifier.
    	 * @param {boolean} [async=false] Whether the element is to be highlighted asynchronously using Web Workers
    	 * to improve performance and avoid blocking the UI when highlighting very large chunks of code. This option is
    	 * [disabled by default](https://prismjs.com/faq.html#why-is-asynchronous-highlighting-disabled-by-default).
    	 *
    	 * Note: All language definitions required to highlight the code must be included in the main `prism.js` file for
    	 * asynchronous highlighting to work. You can build your own bundle on the
    	 * [Download page](https://prismjs.com/download.html).
    	 * @param {HighlightCallback} [callback] An optional callback to be invoked after the highlighting is done.
    	 * Mostly useful when `async` is `true`, since in that case, the highlighting is done asynchronously.
    	 * @memberof Prism
    	 * @public
    	 */
    	highlightElement: function(element, async, callback) {
    		// Find language
    		var language = _.util.getLanguage(element);
    		var grammar = _.languages[language];

    		// Set language on the element, if not present
    		element.className = element.className.replace(lang, '').replace(/\s+/g, ' ') + ' language-' + language;

    		// Set language on the parent, for styling
    		var parent = element.parentElement;
    		if (parent && parent.nodeName.toLowerCase() === 'pre') {
    			parent.className = parent.className.replace(lang, '').replace(/\s+/g, ' ') + ' language-' + language;
    		}

    		var code = element.textContent;

    		var env = {
    			element: element,
    			language: language,
    			grammar: grammar,
    			code: code
    		};

    		function insertHighlightedCode(highlightedCode) {
    			env.highlightedCode = highlightedCode;

    			_.hooks.run('before-insert', env);

    			env.element.innerHTML = env.highlightedCode;

    			_.hooks.run('after-highlight', env);
    			_.hooks.run('complete', env);
    			callback && callback.call(env.element);
    		}

    		_.hooks.run('before-sanity-check', env);

    		if (!env.code) {
    			_.hooks.run('complete', env);
    			callback && callback.call(env.element);
    			return;
    		}

    		_.hooks.run('before-highlight', env);

    		if (!env.grammar) {
    			insertHighlightedCode(_.util.encode(env.code));
    			return;
    		}

    		if (async && _self.Worker) {
    			var worker = new Worker(_.filename);

    			worker.onmessage = function(evt) {
    				insertHighlightedCode(evt.data);
    			};

    			worker.postMessage(JSON.stringify({
    				language: env.language,
    				code: env.code,
    				immediateClose: true
    			}));
    		}
    		else {
    			insertHighlightedCode(_.highlight(env.code, env.grammar, env.language));
    		}
    	},

    	/**
    	 * Low-level function, only use if you know what you’re doing. It accepts a string of text as input
    	 * and the language definitions to use, and returns a string with the HTML produced.
    	 *
    	 * The following hooks will be run:
    	 * 1. `before-tokenize`
    	 * 2. `after-tokenize`
    	 * 3. `wrap`: On each {@link Token}.
    	 *
    	 * @param {string} text A string with the code to be highlighted.
    	 * @param {Grammar} grammar An object containing the tokens to use.
    	 *
    	 * Usually a language definition like `Prism.languages.markup`.
    	 * @param {string} language The name of the language definition passed to `grammar`.
    	 * @returns {string} The highlighted HTML.
    	 * @memberof Prism
    	 * @public
    	 * @example
    	 * Prism.highlight('var foo = true;', Prism.languages.javascript, 'javascript');
    	 */
    	highlight: function (text, grammar, language) {
    		var env = {
    			code: text,
    			grammar: grammar,
    			language: language
    		};
    		_.hooks.run('before-tokenize', env);
    		env.tokens = _.tokenize(env.code, env.grammar);
    		_.hooks.run('after-tokenize', env);
    		return Token.stringify(_.util.encode(env.tokens), env.language);
    	},

    	/**
    	 * This is the heart of Prism, and the most low-level function you can use. It accepts a string of text as input
    	 * and the language definitions to use, and returns an array with the tokenized code.
    	 *
    	 * When the language definition includes nested tokens, the function is called recursively on each of these tokens.
    	 *
    	 * This method could be useful in other contexts as well, as a very crude parser.
    	 *
    	 * @param {string} text A string with the code to be highlighted.
    	 * @param {Grammar} grammar An object containing the tokens to use.
    	 *
    	 * Usually a language definition like `Prism.languages.markup`.
    	 * @returns {TokenStream} An array of strings and tokens, a token stream.
    	 * @memberof Prism
    	 * @public
    	 * @example
    	 * let code = `var foo = 0;`;
    	 * let tokens = Prism.tokenize(code, Prism.languages.javascript);
    	 * tokens.forEach(token => {
    	 *     if (token instanceof Prism.Token && token.type === 'number') {
    	 *         console.log(`Found numeric literal: ${token.content}`);
    	 *     }
    	 * });
    	 */
    	tokenize: function(text, grammar) {
    		var rest = grammar.rest;
    		if (rest) {
    			for (var token in rest) {
    				grammar[token] = rest[token];
    			}

    			delete grammar.rest;
    		}

    		var tokenList = new LinkedList();
    		addAfter(tokenList, tokenList.head, text);

    		matchGrammar(text, tokenList, grammar, tokenList.head, 0);

    		return toArray(tokenList);
    	},

    	/**
    	 * @namespace
    	 * @memberof Prism
    	 * @public
    	 */
    	hooks: {
    		all: {},

    		/**
    		 * Adds the given callback to the list of callbacks for the given hook.
    		 *
    		 * The callback will be invoked when the hook it is registered for is run.
    		 * Hooks are usually directly run by a highlight function but you can also run hooks yourself.
    		 *
    		 * One callback function can be registered to multiple hooks and the same hook multiple times.
    		 *
    		 * @param {string} name The name of the hook.
    		 * @param {HookCallback} callback The callback function which is given environment variables.
    		 * @public
    		 */
    		add: function (name, callback) {
    			var hooks = _.hooks.all;

    			hooks[name] = hooks[name] || [];

    			hooks[name].push(callback);
    		},

    		/**
    		 * Runs a hook invoking all registered callbacks with the given environment variables.
    		 *
    		 * Callbacks will be invoked synchronously and in the order in which they were registered.
    		 *
    		 * @param {string} name The name of the hook.
    		 * @param {Object<string, any>} env The environment variables of the hook passed to all callbacks registered.
    		 * @public
    		 */
    		run: function (name, env) {
    			var callbacks = _.hooks.all[name];

    			if (!callbacks || !callbacks.length) {
    				return;
    			}

    			for (var i=0, callback; callback = callbacks[i++];) {
    				callback(env);
    			}
    		}
    	},

    	Token: Token
    };
    _self.Prism = _;


    // Typescript note:
    // The following can be used to import the Token type in JSDoc:
    //
    //   @typedef {InstanceType<import("./prism-core")["Token"]>} Token

    /**
     * Creates a new token.
     *
     * @param {string} type See {@link Token#type type}
     * @param {string | TokenStream} content See {@link Token#content content}
     * @param {string|string[]} [alias] The alias(es) of the token.
     * @param {string} [matchedStr=""] A copy of the full string this token was created from.
     * @class
     * @global
     * @public
     */
    function Token(type, content, alias, matchedStr) {
    	/**
    	 * The type of the token.
    	 *
    	 * This is usually the key of a pattern in a {@link Grammar}.
    	 *
    	 * @type {string}
    	 * @see GrammarToken
    	 * @public
    	 */
    	this.type = type;
    	/**
    	 * The strings or tokens contained by this token.
    	 *
    	 * This will be a token stream if the pattern matched also defined an `inside` grammar.
    	 *
    	 * @type {string | TokenStream}
    	 * @public
    	 */
    	this.content = content;
    	/**
    	 * The alias(es) of the token.
    	 *
    	 * @type {string|string[]}
    	 * @see GrammarToken
    	 * @public
    	 */
    	this.alias = alias;
    	// Copy of the full string this token was created from
    	this.length = (matchedStr || '').length | 0;
    }

    /**
     * A token stream is an array of strings and {@link Token Token} objects.
     *
     * Token streams have to fulfill a few properties that are assumed by most functions (mostly internal ones) that process
     * them.
     *
     * 1. No adjacent strings.
     * 2. No empty strings.
     *
     *    The only exception here is the token stream that only contains the empty string and nothing else.
     *
     * @typedef {Array<string | Token>} TokenStream
     * @global
     * @public
     */

    /**
     * Converts the given token or token stream to an HTML representation.
     *
     * The following hooks will be run:
     * 1. `wrap`: On each {@link Token}.
     *
     * @param {string | Token | TokenStream} o The token or token stream to be converted.
     * @param {string} language The name of current language.
     * @returns {string} The HTML representation of the token or token stream.
     * @memberof Token
     * @static
     */
    Token.stringify = function stringify(o, language) {
    	if (typeof o == 'string') {
    		return o;
    	}
    	if (Array.isArray(o)) {
    		var s = '';
    		o.forEach(function (e) {
    			s += stringify(e, language);
    		});
    		return s;
    	}

    	var env = {
    		type: o.type,
    		content: stringify(o.content, language),
    		tag: 'span',
    		classes: ['token', o.type],
    		attributes: {},
    		language: language
    	};

    	var aliases = o.alias;
    	if (aliases) {
    		if (Array.isArray(aliases)) {
    			Array.prototype.push.apply(env.classes, aliases);
    		} else {
    			env.classes.push(aliases);
    		}
    	}

    	_.hooks.run('wrap', env);

    	var attributes = '';
    	for (var name in env.attributes) {
    		attributes += ' ' + name + '="' + (env.attributes[name] || '').replace(/"/g, '&quot;') + '"';
    	}

    	return '<' + env.tag + ' class="' + env.classes.join(' ') + '"' + attributes + '>' + env.content + '</' + env.tag + '>';
    };

    /**
     * @param {string} text
     * @param {LinkedList<string | Token>} tokenList
     * @param {any} grammar
     * @param {LinkedListNode<string | Token>} startNode
     * @param {number} startPos
     * @param {RematchOptions} [rematch]
     * @returns {void}
     * @private
     *
     * @typedef RematchOptions
     * @property {string} cause
     * @property {number} reach
     */
    function matchGrammar(text, tokenList, grammar, startNode, startPos, rematch) {
    	for (var token in grammar) {
    		if (!grammar.hasOwnProperty(token) || !grammar[token]) {
    			continue;
    		}

    		var patterns = grammar[token];
    		patterns = Array.isArray(patterns) ? patterns : [patterns];

    		for (var j = 0; j < patterns.length; ++j) {
    			if (rematch && rematch.cause == token + ',' + j) {
    				return;
    			}

    			var patternObj = patterns[j],
    				inside = patternObj.inside,
    				lookbehind = !!patternObj.lookbehind,
    				greedy = !!patternObj.greedy,
    				lookbehindLength = 0,
    				alias = patternObj.alias;

    			if (greedy && !patternObj.pattern.global) {
    				// Without the global flag, lastIndex won't work
    				var flags = patternObj.pattern.toString().match(/[imsuy]*$/)[0];
    				patternObj.pattern = RegExp(patternObj.pattern.source, flags + 'g');
    			}

    			/** @type {RegExp} */
    			var pattern = patternObj.pattern || patternObj;

    			for ( // iterate the token list and keep track of the current token/string position
    				var currentNode = startNode.next, pos = startPos;
    				currentNode !== tokenList.tail;
    				pos += currentNode.value.length, currentNode = currentNode.next
    			) {

    				if (rematch && pos >= rematch.reach) {
    					break;
    				}

    				var str = currentNode.value;

    				if (tokenList.length > text.length) {
    					// Something went terribly wrong, ABORT, ABORT!
    					return;
    				}

    				if (str instanceof Token) {
    					continue;
    				}

    				var removeCount = 1; // this is the to parameter of removeBetween

    				if (greedy && currentNode != tokenList.tail.prev) {
    					pattern.lastIndex = pos;
    					var match = pattern.exec(text);
    					if (!match) {
    						break;
    					}

    					var from = match.index + (lookbehind && match[1] ? match[1].length : 0);
    					var to = match.index + match[0].length;
    					var p = pos;

    					// find the node that contains the match
    					p += currentNode.value.length;
    					while (from >= p) {
    						currentNode = currentNode.next;
    						p += currentNode.value.length;
    					}
    					// adjust pos (and p)
    					p -= currentNode.value.length;
    					pos = p;

    					// the current node is a Token, then the match starts inside another Token, which is invalid
    					if (currentNode.value instanceof Token) {
    						continue;
    					}

    					// find the last node which is affected by this match
    					for (
    						var k = currentNode;
    						k !== tokenList.tail && (p < to || typeof k.value === 'string');
    						k = k.next
    					) {
    						removeCount++;
    						p += k.value.length;
    					}
    					removeCount--;

    					// replace with the new match
    					str = text.slice(pos, p);
    					match.index -= pos;
    				} else {
    					pattern.lastIndex = 0;

    					var match = pattern.exec(str);
    				}

    				if (!match) {
    					continue;
    				}

    				if (lookbehind) {
    					lookbehindLength = match[1] ? match[1].length : 0;
    				}

    				var from = match.index + lookbehindLength,
    					matchStr = match[0].slice(lookbehindLength),
    					to = from + matchStr.length,
    					before = str.slice(0, from),
    					after = str.slice(to);

    				var reach = pos + str.length;
    				if (rematch && reach > rematch.reach) {
    					rematch.reach = reach;
    				}

    				var removeFrom = currentNode.prev;

    				if (before) {
    					removeFrom = addAfter(tokenList, removeFrom, before);
    					pos += before.length;
    				}

    				removeRange(tokenList, removeFrom, removeCount);

    				var wrapped = new Token(token, inside ? _.tokenize(matchStr, inside) : matchStr, alias, matchStr);
    				currentNode = addAfter(tokenList, removeFrom, wrapped);

    				if (after) {
    					addAfter(tokenList, currentNode, after);
    				}

    				if (removeCount > 1) {
    					// at least one Token object was removed, so we have to do some rematching
    					// this can only happen if the current pattern is greedy
    					matchGrammar(text, tokenList, grammar, currentNode.prev, pos, {
    						cause: token + ',' + j,
    						reach: reach
    					});
    				}
    			}
    		}
    	}
    }

    /**
     * @typedef LinkedListNode
     * @property {T} value
     * @property {LinkedListNode<T> | null} prev The previous node.
     * @property {LinkedListNode<T> | null} next The next node.
     * @template T
     * @private
     */

    /**
     * @template T
     * @private
     */
    function LinkedList() {
    	/** @type {LinkedListNode<T>} */
    	var head = { value: null, prev: null, next: null };
    	/** @type {LinkedListNode<T>} */
    	var tail = { value: null, prev: head, next: null };
    	head.next = tail;

    	/** @type {LinkedListNode<T>} */
    	this.head = head;
    	/** @type {LinkedListNode<T>} */
    	this.tail = tail;
    	this.length = 0;
    }

    /**
     * Adds a new node with the given value to the list.
     * @param {LinkedList<T>} list
     * @param {LinkedListNode<T>} node
     * @param {T} value
     * @returns {LinkedListNode<T>} The added node.
     * @template T
     */
    function addAfter(list, node, value) {
    	// assumes that node != list.tail && values.length >= 0
    	var next = node.next;

    	var newNode = { value: value, prev: node, next: next };
    	node.next = newNode;
    	next.prev = newNode;
    	list.length++;

    	return newNode;
    }
    /**
     * Removes `count` nodes after the given node. The given node will not be removed.
     * @param {LinkedList<T>} list
     * @param {LinkedListNode<T>} node
     * @param {number} count
     * @template T
     */
    function removeRange(list, node, count) {
    	var next = node.next;
    	for (var i = 0; i < count && next !== list.tail; i++) {
    		next = next.next;
    	}
    	node.next = next;
    	next.prev = node;
    	list.length -= i;
    }
    /**
     * @param {LinkedList<T>} list
     * @returns {T[]}
     * @template T
     */
    function toArray(list) {
    	var array = [];
    	var node = list.head.next;
    	while (node !== list.tail) {
    		array.push(node.value);
    		node = node.next;
    	}
    	return array;
    }


    if (!_self.document) {
    	if (!_self.addEventListener) {
    		// in Node.js
    		return _;
    	}

    	if (!_.disableWorkerMessageHandler) {
    		// In worker
    		_self.addEventListener('message', function (evt) {
    			var message = JSON.parse(evt.data),
    				lang = message.language,
    				code = message.code,
    				immediateClose = message.immediateClose;

    			_self.postMessage(_.highlight(code, _.languages[lang], lang));
    			if (immediateClose) {
    				_self.close();
    			}
    		}, false);
    	}

    	return _;
    }

    // Get current script and highlight
    var script = _.util.currentScript();

    if (script) {
    	_.filename = script.src;

    	if (script.hasAttribute('data-manual')) {
    		_.manual = true;
    	}
    }

    function highlightAutomaticallyCallback() {
    	if (!_.manual) {
    		_.highlightAll();
    	}
    }

    if (!_.manual) {
    	// If the document state is "loading", then we'll use DOMContentLoaded.
    	// If the document state is "interactive" and the prism.js script is deferred, then we'll also use the
    	// DOMContentLoaded event because there might be some plugins or languages which have also been deferred and they
    	// might take longer one animation frame to execute which can create a race condition where only some plugins have
    	// been loaded when Prism.highlightAll() is executed, depending on how fast resources are loaded.
    	// See https://github.com/PrismJS/prism/issues/2102
    	var readyState = document.readyState;
    	if (readyState === 'loading' || readyState === 'interactive' && script && script.defer) {
    		document.addEventListener('DOMContentLoaded', highlightAutomaticallyCallback);
    	} else {
    		if (window.requestAnimationFrame) {
    			window.requestAnimationFrame(highlightAutomaticallyCallback);
    		} else {
    			window.setTimeout(highlightAutomaticallyCallback, 16);
    		}
    	}
    }

    return _;

    })(_self);

    if ( module.exports) {
    	module.exports = Prism;
    }

    // hack for components to work correctly in node.js
    if (typeof commonjsGlobal !== 'undefined') {
    	commonjsGlobal.Prism = Prism;
    }

    // some additional documentation/types

    /**
     * The expansion of a simple `RegExp` literal to support additional properties.
     *
     * @typedef GrammarToken
     * @property {RegExp} pattern The regular expression of the token.
     * @property {boolean} [lookbehind=false] If `true`, then the first capturing group of `pattern` will (effectively)
     * behave as a lookbehind group meaning that the captured text will not be part of the matched text of the new token.
     * @property {boolean} [greedy=false] Whether the token is greedy.
     * @property {string|string[]} [alias] An optional alias or list of aliases.
     * @property {Grammar} [inside] The nested grammar of this token.
     *
     * The `inside` grammar will be used to tokenize the text value of each token of this kind.
     *
     * This can be used to make nested and even recursive language definitions.
     *
     * Note: This can cause infinite recursion. Be careful when you embed different languages or even the same language into
     * each another.
     * @global
     * @public
    */

    /**
     * @typedef Grammar
     * @type {Object<string, RegExp | GrammarToken | Array<RegExp | GrammarToken>>}
     * @property {Grammar} [rest] An optional grammar object that will be appended to this grammar.
     * @global
     * @public
     */

    /**
     * A function which will invoked after an element was successfully highlighted.
     *
     * @callback HighlightCallback
     * @param {Element} element The element successfully highlighted.
     * @returns {void}
     * @global
     * @public
    */

    /**
     * @callback HookCallback
     * @param {Object<string, any>} env The environment variables of the hook.
     * @returns {void}
     * @global
     * @public
     */


    /* **********************************************
         Begin prism-markup.js
    ********************************************** */

    Prism.languages.markup = {
    	'comment': /<!--[\s\S]*?-->/,
    	'prolog': /<\?[\s\S]+?\?>/,
    	'doctype': {
    		// https://www.w3.org/TR/xml/#NT-doctypedecl
    		pattern: /<!DOCTYPE(?:[^>"'[\]]|"[^"]*"|'[^']*')+(?:\[(?:[^<"'\]]|"[^"]*"|'[^']*'|<(?!!--)|<!--(?:[^-]|-(?!->))*-->)*\]\s*)?>/i,
    		greedy: true,
    		inside: {
    			'internal-subset': {
    				pattern: /(\[)[\s\S]+(?=\]>$)/,
    				lookbehind: true,
    				greedy: true,
    				inside: null // see below
    			},
    			'string': {
    				pattern: /"[^"]*"|'[^']*'/,
    				greedy: true
    			},
    			'punctuation': /^<!|>$|[[\]]/,
    			'doctype-tag': /^DOCTYPE/,
    			'name': /[^\s<>'"]+/
    		}
    	},
    	'cdata': /<!\[CDATA\[[\s\S]*?]]>/i,
    	'tag': {
    		pattern: /<\/?(?!\d)[^\s>\/=$<%]+(?:\s(?:\s*[^\s>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s'">=]+(?=[\s>]))|(?=[\s/>])))+)?\s*\/?>/,
    		greedy: true,
    		inside: {
    			'tag': {
    				pattern: /^<\/?[^\s>\/]+/,
    				inside: {
    					'punctuation': /^<\/?/,
    					'namespace': /^[^\s>\/:]+:/
    				}
    			},
    			'attr-value': {
    				pattern: /=\s*(?:"[^"]*"|'[^']*'|[^\s'">=]+)/,
    				inside: {
    					'punctuation': [
    						{
    							pattern: /^=/,
    							alias: 'attr-equals'
    						},
    						/"|'/
    					]
    				}
    			},
    			'punctuation': /\/?>/,
    			'attr-name': {
    				pattern: /[^\s>\/]+/,
    				inside: {
    					'namespace': /^[^\s>\/:]+:/
    				}
    			}

    		}
    	},
    	'entity': [
    		{
    			pattern: /&[\da-z]{1,8};/i,
    			alias: 'named-entity'
    		},
    		/&#x?[\da-f]{1,8};/i
    	]
    };

    Prism.languages.markup['tag'].inside['attr-value'].inside['entity'] =
    	Prism.languages.markup['entity'];
    Prism.languages.markup['doctype'].inside['internal-subset'].inside = Prism.languages.markup;

    // Plugin to make entity title show the real entity, idea by Roman Komarov
    Prism.hooks.add('wrap', function (env) {

    	if (env.type === 'entity') {
    		env.attributes['title'] = env.content.replace(/&amp;/, '&');
    	}
    });

    Object.defineProperty(Prism.languages.markup.tag, 'addInlined', {
    	/**
    	 * Adds an inlined language to markup.
    	 *
    	 * An example of an inlined language is CSS with `<style>` tags.
    	 *
    	 * @param {string} tagName The name of the tag that contains the inlined language. This name will be treated as
    	 * case insensitive.
    	 * @param {string} lang The language key.
    	 * @example
    	 * addInlined('style', 'css');
    	 */
    	value: function addInlined(tagName, lang) {
    		var includedCdataInside = {};
    		includedCdataInside['language-' + lang] = {
    			pattern: /(^<!\[CDATA\[)[\s\S]+?(?=\]\]>$)/i,
    			lookbehind: true,
    			inside: Prism.languages[lang]
    		};
    		includedCdataInside['cdata'] = /^<!\[CDATA\[|\]\]>$/i;

    		var inside = {
    			'included-cdata': {
    				pattern: /<!\[CDATA\[[\s\S]*?\]\]>/i,
    				inside: includedCdataInside
    			}
    		};
    		inside['language-' + lang] = {
    			pattern: /[\s\S]+/,
    			inside: Prism.languages[lang]
    		};

    		var def = {};
    		def[tagName] = {
    			pattern: RegExp(/(<__[\s\S]*?>)(?:<!\[CDATA\[(?:[^\]]|\](?!\]>))*\]\]>|(?!<!\[CDATA\[)[\s\S])*?(?=<\/__>)/.source.replace(/__/g, function () { return tagName; }), 'i'),
    			lookbehind: true,
    			greedy: true,
    			inside: inside
    		};

    		Prism.languages.insertBefore('markup', 'cdata', def);
    	}
    });

    Prism.languages.html = Prism.languages.markup;
    Prism.languages.mathml = Prism.languages.markup;
    Prism.languages.svg = Prism.languages.markup;

    Prism.languages.xml = Prism.languages.extend('markup', {});
    Prism.languages.ssml = Prism.languages.xml;
    Prism.languages.atom = Prism.languages.xml;
    Prism.languages.rss = Prism.languages.xml;


    /* **********************************************
         Begin prism-css.js
    ********************************************** */

    (function (Prism) {

    	var string = /("|')(?:\\(?:\r\n|[\s\S])|(?!\1)[^\\\r\n])*\1/;

    	Prism.languages.css = {
    		'comment': /\/\*[\s\S]*?\*\//,
    		'atrule': {
    			pattern: /@[\w-]+[\s\S]*?(?:;|(?=\s*\{))/,
    			inside: {
    				'rule': /^@[\w-]+/,
    				'selector-function-argument': {
    					pattern: /(\bselector\s*\((?!\s*\))\s*)(?:[^()]|\((?:[^()]|\([^()]*\))*\))+?(?=\s*\))/,
    					lookbehind: true,
    					alias: 'selector'
    				},
    				'keyword': {
    					pattern: /(^|[^\w-])(?:and|not|only|or)(?![\w-])/,
    					lookbehind: true
    				}
    				// See rest below
    			}
    		},
    		'url': {
    			// https://drafts.csswg.org/css-values-3/#urls
    			pattern: RegExp('\\burl\\((?:' + string.source + '|' + /(?:[^\\\r\n()"']|\\[\s\S])*/.source + ')\\)', 'i'),
    			greedy: true,
    			inside: {
    				'function': /^url/i,
    				'punctuation': /^\(|\)$/,
    				'string': {
    					pattern: RegExp('^' + string.source + '$'),
    					alias: 'url'
    				}
    			}
    		},
    		'selector': RegExp('[^{}\\s](?:[^{};"\']|' + string.source + ')*?(?=\\s*\\{)'),
    		'string': {
    			pattern: string,
    			greedy: true
    		},
    		'property': /[-_a-z\xA0-\uFFFF][-\w\xA0-\uFFFF]*(?=\s*:)/i,
    		'important': /!important\b/i,
    		'function': /[-a-z0-9]+(?=\()/i,
    		'punctuation': /[(){};:,]/
    	};

    	Prism.languages.css['atrule'].inside.rest = Prism.languages.css;

    	var markup = Prism.languages.markup;
    	if (markup) {
    		markup.tag.addInlined('style', 'css');

    		Prism.languages.insertBefore('inside', 'attr-value', {
    			'style-attr': {
    				pattern: /\s*style=("|')(?:\\[\s\S]|(?!\1)[^\\])*\1/i,
    				inside: {
    					'attr-name': {
    						pattern: /^\s*style/i,
    						inside: markup.tag.inside
    					},
    					'punctuation': /^\s*=\s*['"]|['"]\s*$/,
    					'attr-value': {
    						pattern: /.+/i,
    						inside: Prism.languages.css
    					}
    				},
    				alias: 'language-css'
    			}
    		}, markup.tag);
    	}

    }(Prism));


    /* **********************************************
         Begin prism-clike.js
    ********************************************** */

    Prism.languages.clike = {
    	'comment': [
    		{
    			pattern: /(^|[^\\])\/\*[\s\S]*?(?:\*\/|$)/,
    			lookbehind: true
    		},
    		{
    			pattern: /(^|[^\\:])\/\/.*/,
    			lookbehind: true,
    			greedy: true
    		}
    	],
    	'string': {
    		pattern: /(["'])(?:\\(?:\r\n|[\s\S])|(?!\1)[^\\\r\n])*\1/,
    		greedy: true
    	},
    	'class-name': {
    		pattern: /(\b(?:class|interface|extends|implements|trait|instanceof|new)\s+|\bcatch\s+\()[\w.\\]+/i,
    		lookbehind: true,
    		inside: {
    			'punctuation': /[.\\]/
    		}
    	},
    	'keyword': /\b(?:if|else|while|do|for|return|in|instanceof|function|new|try|throw|catch|finally|null|break|continue)\b/,
    	'boolean': /\b(?:true|false)\b/,
    	'function': /\w+(?=\()/,
    	'number': /\b0x[\da-f]+\b|(?:\b\d+\.?\d*|\B\.\d+)(?:e[+-]?\d+)?/i,
    	'operator': /[<>]=?|[!=]=?=?|--?|\+\+?|&&?|\|\|?|[?*/~^%]/,
    	'punctuation': /[{}[\];(),.:]/
    };


    /* **********************************************
         Begin prism-javascript.js
    ********************************************** */

    Prism.languages.javascript = Prism.languages.extend('clike', {
    	'class-name': [
    		Prism.languages.clike['class-name'],
    		{
    			pattern: /(^|[^$\w\xA0-\uFFFF])[_$A-Z\xA0-\uFFFF][$\w\xA0-\uFFFF]*(?=\.(?:prototype|constructor))/,
    			lookbehind: true
    		}
    	],
    	'keyword': [
    		{
    			pattern: /((?:^|})\s*)(?:catch|finally)\b/,
    			lookbehind: true
    		},
    		{
    			pattern: /(^|[^.]|\.\.\.\s*)\b(?:as|async(?=\s*(?:function\b|\(|[$\w\xA0-\uFFFF]|$))|await|break|case|class|const|continue|debugger|default|delete|do|else|enum|export|extends|for|from|function|(?:get|set)(?=\s*[\[$\w\xA0-\uFFFF])|if|implements|import|in|instanceof|interface|let|new|null|of|package|private|protected|public|return|static|super|switch|this|throw|try|typeof|undefined|var|void|while|with|yield)\b/,
    			lookbehind: true
    		},
    	],
    	'number': /\b(?:(?:0[xX](?:[\dA-Fa-f](?:_[\dA-Fa-f])?)+|0[bB](?:[01](?:_[01])?)+|0[oO](?:[0-7](?:_[0-7])?)+)n?|(?:\d(?:_\d)?)+n|NaN|Infinity)\b|(?:\b(?:\d(?:_\d)?)+\.?(?:\d(?:_\d)?)*|\B\.(?:\d(?:_\d)?)+)(?:[Ee][+-]?(?:\d(?:_\d)?)+)?/,
    	// Allow for all non-ASCII characters (See http://stackoverflow.com/a/2008444)
    	'function': /#?[_$a-zA-Z\xA0-\uFFFF][$\w\xA0-\uFFFF]*(?=\s*(?:\.\s*(?:apply|bind|call)\s*)?\()/,
    	'operator': /--|\+\+|\*\*=?|=>|&&=?|\|\|=?|[!=]==|<<=?|>>>?=?|[-+*/%&|^!=<>]=?|\.{3}|\?\?=?|\?\.?|[~:]/
    });

    Prism.languages.javascript['class-name'][0].pattern = /(\b(?:class|interface|extends|implements|instanceof|new)\s+)[\w.\\]+/;

    Prism.languages.insertBefore('javascript', 'keyword', {
    	'regex': {
    		pattern: /((?:^|[^$\w\xA0-\uFFFF."'\])\s]|\b(?:return|yield))\s*)\/(?:\[(?:[^\]\\\r\n]|\\.)*]|\\.|[^/\\\[\r\n])+\/[gimyus]{0,6}(?=(?:\s|\/\*(?:[^*]|\*(?!\/))*\*\/)*(?:$|[\r\n,.;:})\]]|\/\/))/,
    		lookbehind: true,
    		greedy: true
    	},
    	// This must be declared before keyword because we use "function" inside the look-forward
    	'function-variable': {
    		pattern: /#?[_$a-zA-Z\xA0-\uFFFF][$\w\xA0-\uFFFF]*(?=\s*[=:]\s*(?:async\s*)?(?:\bfunction\b|(?:\((?:[^()]|\([^()]*\))*\)|[_$a-zA-Z\xA0-\uFFFF][$\w\xA0-\uFFFF]*)\s*=>))/,
    		alias: 'function'
    	},
    	'parameter': [
    		{
    			pattern: /(function(?:\s+[_$A-Za-z\xA0-\uFFFF][$\w\xA0-\uFFFF]*)?\s*\(\s*)(?!\s)(?:[^()]|\([^()]*\))+?(?=\s*\))/,
    			lookbehind: true,
    			inside: Prism.languages.javascript
    		},
    		{
    			pattern: /[_$a-z\xA0-\uFFFF][$\w\xA0-\uFFFF]*(?=\s*=>)/i,
    			inside: Prism.languages.javascript
    		},
    		{
    			pattern: /(\(\s*)(?!\s)(?:[^()]|\([^()]*\))+?(?=\s*\)\s*=>)/,
    			lookbehind: true,
    			inside: Prism.languages.javascript
    		},
    		{
    			pattern: /((?:\b|\s|^)(?!(?:as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|null|of|package|private|protected|public|return|set|static|super|switch|this|throw|try|typeof|undefined|var|void|while|with|yield)(?![$\w\xA0-\uFFFF]))(?:[_$A-Za-z\xA0-\uFFFF][$\w\xA0-\uFFFF]*\s*)\(\s*|\]\s*\(\s*)(?!\s)(?:[^()]|\([^()]*\))+?(?=\s*\)\s*\{)/,
    			lookbehind: true,
    			inside: Prism.languages.javascript
    		}
    	],
    	'constant': /\b[A-Z](?:[A-Z_]|\dx?)*\b/
    });

    Prism.languages.insertBefore('javascript', 'string', {
    	'template-string': {
    		pattern: /`(?:\\[\s\S]|\${(?:[^{}]|{(?:[^{}]|{[^}]*})*})+}|(?!\${)[^\\`])*`/,
    		greedy: true,
    		inside: {
    			'template-punctuation': {
    				pattern: /^`|`$/,
    				alias: 'string'
    			},
    			'interpolation': {
    				pattern: /((?:^|[^\\])(?:\\{2})*)\${(?:[^{}]|{(?:[^{}]|{[^}]*})*})+}/,
    				lookbehind: true,
    				inside: {
    					'interpolation-punctuation': {
    						pattern: /^\${|}$/,
    						alias: 'punctuation'
    					},
    					rest: Prism.languages.javascript
    				}
    			},
    			'string': /[\s\S]+/
    		}
    	}
    });

    if (Prism.languages.markup) {
    	Prism.languages.markup.tag.addInlined('script', 'javascript');
    }

    Prism.languages.js = Prism.languages.javascript;


    /* **********************************************
         Begin prism-file-highlight.js
    ********************************************** */

    (function () {
    	if (typeof self === 'undefined' || !self.Prism || !self.document) {
    		return;
    	}

    	var Prism = window.Prism;

    	var LOADING_MESSAGE = 'Loading…';
    	var FAILURE_MESSAGE = function (status, message) {
    		return '✖ Error ' + status + ' while fetching file: ' + message;
    	};
    	var FAILURE_EMPTY_MESSAGE = '✖ Error: File does not exist or is empty';

    	var EXTENSIONS = {
    		'js': 'javascript',
    		'py': 'python',
    		'rb': 'ruby',
    		'ps1': 'powershell',
    		'psm1': 'powershell',
    		'sh': 'bash',
    		'bat': 'batch',
    		'h': 'c',
    		'tex': 'latex'
    	};

    	var STATUS_ATTR = 'data-src-status';
    	var STATUS_LOADING = 'loading';
    	var STATUS_LOADED = 'loaded';
    	var STATUS_FAILED = 'failed';

    	var SELECTOR = 'pre[data-src]:not([' + STATUS_ATTR + '="' + STATUS_LOADED + '"])'
    		+ ':not([' + STATUS_ATTR + '="' + STATUS_LOADING + '"])';

    	var lang = /\blang(?:uage)?-([\w-]+)\b/i;

    	/**
    	 * Sets the Prism `language-xxxx` or `lang-xxxx` class to the given language.
    	 *
    	 * @param {HTMLElement} element
    	 * @param {string} language
    	 * @returns {void}
    	 */
    	function setLanguageClass(element, language) {
    		var className = element.className;
    		className = className.replace(lang, ' ') + ' language-' + language;
    		element.className = className.replace(/\s+/g, ' ').trim();
    	}


    	Prism.hooks.add('before-highlightall', function (env) {
    		env.selector += ', ' + SELECTOR;
    	});

    	Prism.hooks.add('before-sanity-check', function (env) {
    		var pre = /** @type {HTMLPreElement} */ (env.element);
    		if (pre.matches(SELECTOR)) {
    			env.code = ''; // fast-path the whole thing and go to complete

    			pre.setAttribute(STATUS_ATTR, STATUS_LOADING); // mark as loading

    			// add code element with loading message
    			var code = pre.appendChild(document.createElement('CODE'));
    			code.textContent = LOADING_MESSAGE;

    			var src = pre.getAttribute('data-src');

    			var language = env.language;
    			if (language === 'none') {
    				// the language might be 'none' because there is no language set;
    				// in this case, we want to use the extension as the language
    				var extension = (/\.(\w+)$/.exec(src) || [, 'none'])[1];
    				language = EXTENSIONS[extension] || extension;
    			}

    			// set language classes
    			setLanguageClass(code, language);
    			setLanguageClass(pre, language);

    			// preload the language
    			var autoloader = Prism.plugins.autoloader;
    			if (autoloader) {
    				autoloader.loadLanguages(language);
    			}

    			// load file
    			var xhr = new XMLHttpRequest();
    			xhr.open('GET', src, true);
    			xhr.onreadystatechange = function () {
    				if (xhr.readyState == 4) {
    					if (xhr.status < 400 && xhr.responseText) {
    						// mark as loaded
    						pre.setAttribute(STATUS_ATTR, STATUS_LOADED);

    						// highlight code
    						code.textContent = xhr.responseText;
    						Prism.highlightElement(code);

    					} else {
    						// mark as failed
    						pre.setAttribute(STATUS_ATTR, STATUS_FAILED);

    						if (xhr.status >= 400) {
    							code.textContent = FAILURE_MESSAGE(xhr.status, xhr.statusText);
    						} else {
    							code.textContent = FAILURE_EMPTY_MESSAGE;
    						}
    					}
    				}
    			};
    			xhr.send(null);
    		}
    	});

    	Prism.plugins.fileHighlight = {
    		/**
    		 * Executes the File Highlight plugin for all matching `pre` elements under the given container.
    		 *
    		 * Note: Elements which are already loaded or currently loading will not be touched by this method.
    		 *
    		 * @param {ParentNode} [container=document]
    		 */
    		highlight: function highlight(container) {
    			var elements = (container || document).querySelectorAll(SELECTOR);

    			for (var i = 0, element; element = elements[i++];) {
    				Prism.highlightElement(element);
    			}
    		}
    	};

    	var logged = false;
    	/** @deprecated Use `Prism.plugins.fileHighlight.highlight` instead. */
    	Prism.fileHighlight = function () {
    		if (!logged) {
    			console.warn('Prism.fileHighlight is deprecated. Use `Prism.plugins.fileHighlight.highlight` instead.');
    			logged = true;
    		}
    		Prism.plugins.fileHighlight.highlight.apply(this, arguments);
    	};

    })();
    });

    (function () {

    	if (typeof self === 'undefined' || !self.Prism || !self.document) {
    		return;
    	}

    	/**
    	 * Plugin name which is used as a class name for <pre> which is activating the plugin
    	 * @type {String}
    	 */
    	var PLUGIN_NAME = 'line-numbers';

    	/**
    	 * Regular expression used for determining line breaks
    	 * @type {RegExp}
    	 */
    	var NEW_LINE_EXP = /\n(?!$)/g;


    	/**
    	 * Global exports
    	 */
    	var config = Prism.plugins.lineNumbers = {
    		/**
    		 * Get node for provided line number
    		 * @param {Element} element pre element
    		 * @param {Number} number line number
    		 * @return {Element|undefined}
    		 */
    		getLine: function (element, number) {
    			if (element.tagName !== 'PRE' || !element.classList.contains(PLUGIN_NAME)) {
    				return;
    			}

    			var lineNumberRows = element.querySelector('.line-numbers-rows');
    			var lineNumberStart = parseInt(element.getAttribute('data-start'), 10) || 1;
    			var lineNumberEnd = lineNumberStart + (lineNumberRows.children.length - 1);

    			if (number < lineNumberStart) {
    				number = lineNumberStart;
    			}
    			if (number > lineNumberEnd) {
    				number = lineNumberEnd;
    			}

    			var lineIndex = number - lineNumberStart;

    			return lineNumberRows.children[lineIndex];
    		},

    		/**
    		 * Resizes the line numbers of the given element.
    		 *
    		 * This function will not add line numbers. It will only resize existing ones.
    		 * @param {HTMLElement} element A `<pre>` element with line numbers.
    		 * @returns {void}
    		 */
    		resize: function (element) {
    			resizeElements([element]);
    		},

    		/**
    		 * Whether the plugin can assume that the units font sizes and margins are not depended on the size of
    		 * the current viewport.
    		 *
    		 * Setting this to `true` will allow the plugin to do certain optimizations for better performance.
    		 *
    		 * Set this to `false` if you use any of the following CSS units: `vh`, `vw`, `vmin`, `vmax`.
    		 *
    		 * @type {boolean}
    		 */
    		assumeViewportIndependence: true
    	};

    	/**
    	 * Resizes the given elements.
    	 *
    	 * @param {HTMLElement[]} elements
    	 */
    	function resizeElements(elements) {
    		elements = elements.filter(function (e) {
    			var codeStyles = getStyles(e);
    			var whiteSpace = codeStyles['white-space'];
    			return whiteSpace === 'pre-wrap' || whiteSpace === 'pre-line';
    		});

    		if (elements.length == 0) {
    			return;
    		}

    		var infos = elements.map(function (element) {
    			var codeElement = element.querySelector('code');
    			var lineNumbersWrapper = element.querySelector('.line-numbers-rows');
    			if (!codeElement || !lineNumbersWrapper) {
    				return undefined;
    			}

    			/** @type {HTMLElement} */
    			var lineNumberSizer = element.querySelector('.line-numbers-sizer');
    			var codeLines = codeElement.textContent.split(NEW_LINE_EXP);

    			if (!lineNumberSizer) {
    				lineNumberSizer = document.createElement('span');
    				lineNumberSizer.className = 'line-numbers-sizer';

    				codeElement.appendChild(lineNumberSizer);
    			}

    			lineNumberSizer.innerHTML = '0';
    			lineNumberSizer.style.display = 'block';

    			var oneLinerHeight = lineNumberSizer.getBoundingClientRect().height;
    			lineNumberSizer.innerHTML = '';

    			return {
    				element: element,
    				lines: codeLines,
    				lineHeights: [],
    				oneLinerHeight: oneLinerHeight,
    				sizer: lineNumberSizer,
    			};
    		}).filter(Boolean);

    		infos.forEach(function (info) {
    			var lineNumberSizer = info.sizer;
    			var lines = info.lines;
    			var lineHeights = info.lineHeights;
    			var oneLinerHeight = info.oneLinerHeight;

    			lineHeights[lines.length - 1] = undefined;
    			lines.forEach(function (line, index) {
    				if (line && line.length > 1) {
    					var e = lineNumberSizer.appendChild(document.createElement('span'));
    					e.style.display = 'block';
    					e.textContent = line;
    				} else {
    					lineHeights[index] = oneLinerHeight;
    				}
    			});
    		});

    		infos.forEach(function (info) {
    			var lineNumberSizer = info.sizer;
    			var lineHeights = info.lineHeights;

    			var childIndex = 0;
    			for (var i = 0; i < lineHeights.length; i++) {
    				if (lineHeights[i] === undefined) {
    					lineHeights[i] = lineNumberSizer.children[childIndex++].getBoundingClientRect().height;
    				}
    			}
    		});

    		infos.forEach(function (info) {
    			var lineNumberSizer = info.sizer;
    			var wrapper = info.element.querySelector('.line-numbers-rows');

    			lineNumberSizer.style.display = 'none';
    			lineNumberSizer.innerHTML = '';

    			info.lineHeights.forEach(function (height, lineNumber) {
    				wrapper.children[lineNumber].style.height = height + 'px';
    			});
    		});
    	}

    	/**
    	 * Returns style declarations for the element
    	 * @param {Element} element
    	 */
    	var getStyles = function (element) {
    		if (!element) {
    			return null;
    		}

    		return window.getComputedStyle ? getComputedStyle(element) : (element.currentStyle || null);
    	};

    	var lastWidth = undefined;
    	window.addEventListener('resize', function () {
    		if (config.assumeViewportIndependence && lastWidth === window.innerWidth) {
    			return;
    		}
    		lastWidth = window.innerWidth;

    		resizeElements(Array.prototype.slice.call(document.querySelectorAll('pre.' + PLUGIN_NAME)));
    	});

    	Prism.hooks.add('complete', function (env) {
    		if (!env.code) {
    			return;
    		}

    		var code = /** @type {Element} */ (env.element);
    		var pre = /** @type {HTMLElement} */ (code.parentNode);

    		// works only for <code> wrapped inside <pre> (not inline)
    		if (!pre || !/pre/i.test(pre.nodeName)) {
    			return;
    		}

    		// Abort if line numbers already exists
    		if (code.querySelector('.line-numbers-rows')) {
    			return;
    		}

    		// only add line numbers if <code> or one of its ancestors has the `line-numbers` class
    		if (!Prism.util.isActive(code, PLUGIN_NAME)) {
    			return;
    		}

    		// Remove the class 'line-numbers' from the <code>
    		code.classList.remove(PLUGIN_NAME);
    		// Add the class 'line-numbers' to the <pre>
    		pre.classList.add(PLUGIN_NAME);

    		var match = env.code.match(NEW_LINE_EXP);
    		var linesNum = match ? match.length + 1 : 1;
    		var lineNumbersWrapper;

    		var lines = new Array(linesNum + 1).join('<span></span>');

    		lineNumbersWrapper = document.createElement('span');
    		lineNumbersWrapper.setAttribute('aria-hidden', 'true');
    		lineNumbersWrapper.className = 'line-numbers-rows';
    		lineNumbersWrapper.innerHTML = lines;

    		if (pre.hasAttribute('data-start')) {
    			pre.style.counterReset = 'linenumber ' + (parseInt(pre.getAttribute('data-start'), 10) - 1);
    		}

    		env.element.appendChild(lineNumbersWrapper);

    		resizeElements([pre]);

    		Prism.hooks.run('line-numbers', env);
    	});

    	Prism.hooks.add('line-numbers', function (env) {
    		env.plugins = env.plugins || {};
    		env.plugins.lineNumbers = true;
    	});

    }());

    var prismNormalizeWhitespace = createCommonjsModule(function (module) {
    (function() {

    var assign = Object.assign || function (obj1, obj2) {
    	for (var name in obj2) {
    		if (obj2.hasOwnProperty(name))
    			obj1[name] = obj2[name];
    	}
    	return obj1;
    };

    function NormalizeWhitespace(defaults) {
    	this.defaults = assign({}, defaults);
    }

    function toCamelCase(value) {
    	return value.replace(/-(\w)/g, function(match, firstChar) {
    		return firstChar.toUpperCase();
    	});
    }

    function tabLen(str) {
    	var res = 0;
    	for (var i = 0; i < str.length; ++i) {
    		if (str.charCodeAt(i) == '\t'.charCodeAt(0))
    			res += 3;
    	}
    	return str.length + res;
    }

    NormalizeWhitespace.prototype = {
    	setDefaults: function (defaults) {
    		this.defaults = assign(this.defaults, defaults);
    	},
    	normalize: function (input, settings) {
    		settings = assign(this.defaults, settings);

    		for (var name in settings) {
    			var methodName = toCamelCase(name);
    			if (name !== "normalize" && methodName !== 'setDefaults' &&
    					settings[name] && this[methodName]) {
    				input = this[methodName].call(this, input, settings[name]);
    			}
    		}

    		return input;
    	},

    	/*
    	 * Normalization methods
    	 */
    	leftTrim: function (input) {
    		return input.replace(/^\s+/, '');
    	},
    	rightTrim: function (input) {
    		return input.replace(/\s+$/, '');
    	},
    	tabsToSpaces: function (input, spaces) {
    		spaces = spaces|0 || 4;
    		return input.replace(/\t/g, new Array(++spaces).join(' '));
    	},
    	spacesToTabs: function (input, spaces) {
    		spaces = spaces|0 || 4;
    		return input.replace(RegExp(' {' + spaces + '}', 'g'), '\t');
    	},
    	removeTrailing: function (input) {
    		return input.replace(/\s*?$/gm, '');
    	},
    	// Support for deprecated plugin remove-initial-line-feed
    	removeInitialLineFeed: function (input) {
    		return input.replace(/^(?:\r?\n|\r)/, '');
    	},
    	removeIndent: function (input) {
    		var indents = input.match(/^[^\S\n\r]*(?=\S)/gm);

    		if (!indents || !indents[0].length)
    			return input;

    		indents.sort(function(a, b){return a.length - b.length; });

    		if (!indents[0].length)
    			return input;

    		return input.replace(RegExp('^' + indents[0], 'gm'), '');
    	},
    	indent: function (input, tabs) {
    		return input.replace(/^[^\S\n\r]*(?=\S)/gm, new Array(++tabs).join('\t') + '$&');
    	},
    	breakLines: function (input, characters) {
    		characters = (characters === true) ? 80 : characters|0 || 80;

    		var lines = input.split('\n');
    		for (var i = 0; i < lines.length; ++i) {
    			if (tabLen(lines[i]) <= characters)
    				continue;

    			var line = lines[i].split(/(\s+)/g),
    			    len = 0;

    			for (var j = 0; j < line.length; ++j) {
    				var tl = tabLen(line[j]);
    				len += tl;
    				if (len > characters) {
    					line[j] = '\n' + line[j];
    					len = tl;
    				}
    			}
    			lines[i] = line.join('');
    		}
    		return lines.join('\n');
    	}
    };

    // Support node modules
    if ( module.exports) {
    	module.exports = NormalizeWhitespace;
    }

    // Exit if prism is not loaded
    if (typeof Prism === 'undefined') {
    	return;
    }

    Prism.plugins.NormalizeWhitespace = new NormalizeWhitespace({
    	'remove-trailing': true,
    	'remove-indent': true,
    	'left-trim': true,
    	'right-trim': true,
    	/*'break-lines': 80,
    	'indent': 2,
    	'remove-initial-line-feed': false,
    	'tabs-to-spaces': 4,
    	'spaces-to-tabs': 4*/
    });

    Prism.hooks.add('before-sanity-check', function (env) {
    	var Normalizer = Prism.plugins.NormalizeWhitespace;

    	// Check settings
    	if (env.settings && env.settings['whitespace-normalization'] === false) {
    		return;
    	}

    	// Check classes
    	if (!Prism.util.isActive(env.element, 'whitespace-normalization', true)) {
    		return;
    	}

    	// Simple mode if there is no env.element
    	if ((!env.element || !env.element.parentNode) && env.code) {
    		env.code = Normalizer.normalize(env.code, env.settings);
    		return;
    	}

    	// Normal mode
    	var pre = env.element.parentNode;
    	if (!env.code || !pre || pre.nodeName.toLowerCase() !== 'pre') {
    		return;
    	}

    	var children = pre.childNodes,
    	    before = '',
    	    after = '',
    	    codeFound = false;

    	// Move surrounding whitespace from the <pre> tag into the <code> tag
    	for (var i = 0; i < children.length; ++i) {
    		var node = children[i];

    		if (node == env.element) {
    			codeFound = true;
    		} else if (node.nodeName === "#text") {
    			if (codeFound) {
    				after += node.nodeValue;
    			} else {
    				before += node.nodeValue;
    			}

    			pre.removeChild(node);
    			--i;
    		}
    	}

    	if (!env.element.children.length || !Prism.plugins.KeepMarkup) {
    		env.code = before + env.code + after;
    		env.code = Normalizer.normalize(env.code, env.settings);
    	} else {
    		// Preserve markup for keep-markup plugin
    		var html = before + env.element.innerHTML + after;
    		env.element.innerHTML = Normalizer.normalize(html, env.settings);
    		env.code = env.element.textContent;
    	}
    });

    }());
    });

    /* src/Prism.svelte generated by Svelte v3.24.1 */

    function create_fragment(ctx) {
    	let code0;
    	let t;
    	let pre;
    	let code1;
    	let code1_class_value;
    	let pre_class_value;
    	let current;
    	const default_slot_template = /*$$slots*/ ctx[12].default;
    	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[11], null);

    	let pre_levels = [
    		{
    			class: pre_class_value = "" + (/*prismClasses*/ ctx[5] + " " + /*classes*/ ctx[1])
    		},
    		/*$$restProps*/ ctx[6]
    	];

    	let pre_data = {};

    	for (let i = 0; i < pre_levels.length; i += 1) {
    		pre_data = assign(pre_data, pre_levels[i]);
    	}

    	return {
    		c() {
    			code0 = element("code");
    			if (default_slot) default_slot.c();
    			t = space();
    			pre = element("pre");
    			code1 = element("code");
    			set_style(code0, "display", "none");
    			attr(code1, "class", code1_class_value = "language-" + /*language*/ ctx[0]);
    			set_attributes(pre, pre_data);
    		},
    		m(target, anchor) {
    			insert(target, code0, anchor);

    			if (default_slot) {
    				default_slot.m(code0, null);
    			}

    			/*code0_binding*/ ctx[13](code0);
    			insert(target, t, anchor);
    			insert(target, pre, anchor);
    			append(pre, code1);
    			code1.innerHTML = /*formattedCode*/ ctx[4];
    			/*pre_binding*/ ctx[14](pre);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			if (default_slot) {
    				if (default_slot.p && dirty & /*$$scope*/ 2048) {
    					update_slot(default_slot, default_slot_template, ctx, /*$$scope*/ ctx[11], dirty, null, null);
    				}
    			}

    			if (!current || dirty & /*formattedCode*/ 16) code1.innerHTML = /*formattedCode*/ ctx[4];
    			if (!current || dirty & /*language*/ 1 && code1_class_value !== (code1_class_value = "language-" + /*language*/ ctx[0])) {
    				attr(code1, "class", code1_class_value);
    			}

    			set_attributes(pre, pre_data = get_spread_update(pre_levels, [
    				(!current || dirty & /*prismClasses, classes*/ 34 && pre_class_value !== (pre_class_value = "" + (/*prismClasses*/ ctx[5] + " " + /*classes*/ ctx[1]))) && { class: pre_class_value },
    				dirty & /*$$restProps*/ 64 && /*$$restProps*/ ctx[6]
    			]));
    		},
    		i(local) {
    			if (current) return;
    			transition_in(default_slot, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(default_slot, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(code0);
    			if (default_slot) default_slot.d(detaching);
    			/*code0_binding*/ ctx[13](null);
    			if (detaching) detach(t);
    			if (detaching) detach(pre);
    			/*pre_binding*/ ctx[14](null);
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	const omit_props_names = [
    		"code","language","showLineNumbers","normalizeWhiteSpace","normalizeWhiteSpaceConfig","classes"
    	];

    	let $$restProps = compute_rest_props($$props, omit_props_names);
    	let { code = "" } = $$props;
    	let { language = "javascript" } = $$props;
    	let { showLineNumbers = false } = $$props;
    	let { normalizeWhiteSpace = true } = $$props;

    	let { normalizeWhiteSpaceConfig = {
    		"remove-trailing": true,
    		"remove-indent": true,
    		"left-trim": true,
    		"right-trim": true
    	} } = $$props; /*'break-lines': 80,
    	'indent': 2,
    	'remove-initial-line-feed': false,
    	'tabs-to-spaces': 4,
    	'spaces-to-tabs': 4*/

    	let { classes = "" } = $$props;

    	// This is the fake coding element
    	let fakeCodeEl;

    	// This is pre Element
    	let preEl;

    	// This stored the formatted HTML to display
    	let formattedCode = "";

    	onMount(() => {
    		if (normalizeWhiteSpace) {
    			Prism.plugins.NormalizeWhitespace.setDefaults(normalizeWhiteSpaceConfig);
    		}
    	});

    	afterUpdate(async node => {
    		// code variable if they are using a prop
    		// Have to use innerText because innerHTML will create weird escape characaters
    		if (fakeCodeEl && fakeCodeEl.innerText !== "") {
    			$$invalidate(7, code = fakeCodeEl.innerText);
    		}

    		// We need to wait till everything been rendered before we can
    		// call highlightAll and load all the plugins
    		await tick();

    		// This will make sure all the plugins are loaded
    		// Prism.highlight will not do that
    		Prism.highlightAllUnder(preEl);
    	});

    	let { $$slots = {}, $$scope } = $$props;

    	function code0_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			fakeCodeEl = $$value;
    			$$invalidate(2, fakeCodeEl);
    		});
    	}

    	function pre_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			preEl = $$value;
    			$$invalidate(3, preEl);
    		});
    	}

    	$$self.$$set = $$new_props => {
    		$$props = assign(assign({}, $$props), exclude_internal_props($$new_props));
    		$$invalidate(6, $$restProps = compute_rest_props($$props, omit_props_names));
    		if ("code" in $$new_props) $$invalidate(7, code = $$new_props.code);
    		if ("language" in $$new_props) $$invalidate(0, language = $$new_props.language);
    		if ("showLineNumbers" in $$new_props) $$invalidate(8, showLineNumbers = $$new_props.showLineNumbers);
    		if ("normalizeWhiteSpace" in $$new_props) $$invalidate(9, normalizeWhiteSpace = $$new_props.normalizeWhiteSpace);
    		if ("normalizeWhiteSpaceConfig" in $$new_props) $$invalidate(10, normalizeWhiteSpaceConfig = $$new_props.normalizeWhiteSpaceConfig);
    		if ("classes" in $$new_props) $$invalidate(1, classes = $$new_props.classes);
    		if ("$$scope" in $$new_props) $$invalidate(11, $$scope = $$new_props.$$scope);
    	};

    	let prismClasses;

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*language, showLineNumbers, normalizeWhiteSpace*/ 769) {
    			// creates the prism classes
    			 $$invalidate(5, prismClasses = `language-${language} ${showLineNumbers ? "line-numbers" : ""} ${normalizeWhiteSpace === true
			? ""
			: "no-whitespace-normalization"}`);
    		}

    		if ($$self.$$.dirty & /*code, language*/ 129) {
    			// Only run if Prism is defined and we code
    			 if (typeof Prism !== "undefined" && code) {
    				$$invalidate(4, formattedCode = Prism.highlight(code, Prism.languages[language], language));
    			}
    		}
    	};

    	return [
    		language,
    		classes,
    		fakeCodeEl,
    		preEl,
    		formattedCode,
    		prismClasses,
    		$$restProps,
    		code,
    		showLineNumbers,
    		normalizeWhiteSpace,
    		normalizeWhiteSpaceConfig,
    		$$scope,
    		$$slots,
    		code0_binding,
    		pre_binding
    	];
    }

    class Prism_1 extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(this, options, instance, create_fragment, safe_not_equal, {
    			code: 7,
    			language: 0,
    			showLineNumbers: 8,
    			normalizeWhiteSpace: 9,
    			normalizeWhiteSpaceConfig: 10,
    			classes: 1
    		});
    	}
    }

    Prism.languages.c = Prism.languages.extend('clike', {
    	'comment': {
    		pattern: /\/\/(?:[^\r\n\\]|\\(?:\r\n?|\n|(?![\r\n])))*|\/\*[\s\S]*?(?:\*\/|$)/,
    		greedy: true
    	},
    	'class-name': {
    		pattern: /(\b(?:enum|struct)\s+(?:__attribute__\s*\(\([\s\S]*?\)\)\s*)?)\w+/,
    		lookbehind: true
    	},
    	'keyword': /\b(?:__attribute__|_Alignas|_Alignof|_Atomic|_Bool|_Complex|_Generic|_Imaginary|_Noreturn|_Static_assert|_Thread_local|asm|typeof|inline|auto|break|case|char|const|continue|default|do|double|else|enum|extern|float|for|goto|if|int|long|register|return|short|signed|sizeof|static|struct|switch|typedef|union|unsigned|void|volatile|while)\b/,
    	'function': /[a-z_]\w*(?=\s*\()/i,
    	'operator': />>=?|<<=?|->|([-+&|:])\1|[?:~]|[-+*/%&|^!=<>]=?/,
    	'number': /(?:\b0x(?:[\da-f]+\.?[\da-f]*|\.[\da-f]+)(?:p[+-]?\d+)?|(?:\b\d+\.?\d*|\B\.\d+)(?:e[+-]?\d+)?)[ful]*/i
    });

    Prism.languages.insertBefore('c', 'string', {
    	'macro': {
    		// allow for multiline macro definitions
    		// spaces after the # character compile fine with gcc
    		pattern: /(^\s*)#\s*[a-z]+(?:[^\r\n\\/]|\/(?!\*)|\/\*(?:[^*]|\*(?!\/))*\*\/|\\(?:\r\n|[\s\S]))*/im,
    		lookbehind: true,
    		greedy: true,
    		alias: 'property',
    		inside: {
    			'string': [
    				{
    					// highlight the path of the include statement as a string
    					pattern: /^(#\s*include\s*)<[^>]+>/,
    					lookbehind: true
    				},
    				Prism.languages.c['string']
    			],
    			'comment': Prism.languages.c['comment'],
    			// highlight macro directives as keywords
    			'directive': {
    				pattern: /^(#\s*)[a-z]+/,
    				lookbehind: true,
    				alias: 'keyword'
    			},
    			'directive-hash': /^#/,
    			'punctuation': /##|\\(?=[\r\n])/,
    			'expression': {
    				pattern: /\S[\s\S]*/,
    				inside: Prism.languages.c
    			}
    		}
    	},
    	// highlight predefined macros as constants
    	'constant': /\b(?:__FILE__|__LINE__|__DATE__|__TIME__|__TIMESTAMP__|__func__|EOF|NULL|SEEK_CUR|SEEK_END|SEEK_SET|stdin|stdout|stderr)\b/
    });

    delete Prism.languages.c['boolean'];

    const blocks = '(if|else if|await|then|catch|each|html|debug)';

    Prism.languages.svelte = Prism.languages.extend('markup', {
    	each: {
    		pattern: new RegExp(
    			'{[#/]each' +
    				'(?:(?:\\{(?:(?:\\{(?:[^{}])*\\})|(?:[^{}]))*\\})|(?:[^{}]))*}'
    		),
    		inside: {
    			'language-javascript': [
    				{
    					pattern: /(as[\s\S]*)\([\s\S]*\)(?=\s*\})/,
    					lookbehind: true,
    					inside: Prism.languages['javascript'],
    				},
    				{
    					pattern: /(as[\s]*)[\s\S]*(?=\s*)/,
    					lookbehind: true,
    					inside: Prism.languages['javascript'],
    				},
    				{
    					pattern: /(#each[\s]*)[\s\S]*(?=as)/,
    					lookbehind: true,
    					inside: Prism.languages['javascript'],
    				},
    			],
    			keyword: /[#/]each|as/,
    			punctuation: /{|}/,
    		},
    	},
    	block: {
    		pattern: new RegExp(
    			'{[#:/@]/s' +
    				blocks +
    				'(?:(?:\\{(?:(?:\\{(?:[^{}])*\\})|(?:[^{}]))*\\})|(?:[^{}]))*}'
    		),
    		inside: {
    			punctuation: /^{|}$/,
    			keyword: [new RegExp('[#:/@]' + blocks + '( )*'), /as/, /then/],
    			'language-javascript': {
    				pattern: /[\s\S]*/,
    				inside: Prism.languages['javascript'],
    			},
    		},
    	},
    	tag: {
    		pattern: /<\/?(?!\d)[^\s>\/=$<%]+(?:\s(?:\s*[^\s>\/=]+(?:\s*=\s*(?:(?:"[^"]*"|'[^']*'|[^\s'">=]+(?=[\s>]))|(?:"[^"]*"|'[^']*'|{[\s\S]+?}(?=[\s/>])))|(?=[\s/>])))+)?\s*\/?>/i,
    		greedy: true,
    		inside: {
    			tag: {
    				pattern: /^<\/?[^\s>\/]+/i,
    				inside: {
    					punctuation: /^<\/?/,
    					namespace: /^[^\s>\/:]+:/,
    				},
    			},
    			'language-javascript': {
    				pattern: /\{(?:(?:\{(?:(?:\{(?:[^{}])*\})|(?:[^{}]))*\})|(?:[^{}]))*\}/,
    				inside: Prism.languages['javascript'],
    			},
    			'attr-value': {
    				pattern: /=\s*(?:"[^"]*"|'[^']*'|[^\s'">=]+)/i,
    				inside: {
    					punctuation: [
    						/^=/,
    						{
    							pattern: /^(\s*)["']|["']$/,
    							lookbehind: true,
    						},
    					],
    					'language-javascript': {
    						pattern: /{[\s\S]+}/,
    						inside: Prism.languages['javascript'],
    					},
    				},
    			},
    			punctuation: /\/?>/,
    			'attr-name': {
    				pattern: /[^\s>\/]+/,
    				inside: {
    					namespace: /^[^\s>\/:]+:/,
    				},
    			},
    		},
    	},
    	'language-javascript': {
    		pattern: /\{(?:(?:\{(?:(?:\{(?:[^{}])*\})|(?:[^{}]))*\})|(?:[^{}]))*\}/,
    		lookbehind: true,
    		inside: Prism.languages['javascript'],
    	},
    });

    Prism.languages.svelte['tag'].inside['attr-value'].inside['entity'] =
    	Prism.languages.svelte['entity'];

    Prism.hooks.add('wrap', env => {
    	if (env.type === 'entity') {
    		env.attributes['title'] = env.content.replace(/&amp;/, '&');
    	}
    });

    Object.defineProperty(Prism.languages.svelte.tag, 'addInlined', {
    	value: function addInlined(tagName, lang) {
    		const includedCdataInside = {};
    		includedCdataInside['language-' + lang] = {
    			pattern: /(^<!\[CDATA\[)[\s\S]+?(?=\]\]>$)/i,
    			lookbehind: true,
    			inside: Prism.languages[lang],
    		};
    		includedCdataInside['cdata'] = /^<!\[CDATA\[|\]\]>$/i;

    		const inside = {
    			'included-cdata': {
    				pattern: /<!\[CDATA\[[\s\S]*?\]\]>/i,
    				inside: includedCdataInside,
    			},
    		};
    		inside['language-' + lang] = {
    			pattern: /[\s\S]+/,
    			inside: Prism.languages[lang],
    		};

    		const def = {};
    		def[tagName] = {
    			pattern: RegExp(
    				/(<__[\s\S]*?>)(?:<!\[CDATA\[[\s\S]*?\]\]>\s*|[\s\S])*?(?=<\/__>)/.source.replace(
    					/__/g,
    					tagName
    				),
    				'i'
    			),
    			lookbehind: true,
    			greedy: true,
    			inside,
    		};

    		Prism.languages.insertBefore('svelte', 'cdata', def);
    	},
    });

    Prism.languages.svelte.tag.addInlined('style', 'css');
    Prism.languages.svelte.tag.addInlined('script', 'javascript');

    (function () {

    	if (typeof self === 'undefined' || !self.Prism || !self.document || !document.querySelector) {
    		return;
    	}

    	/**
    	 * @param {string} selector
    	 * @param {ParentNode} [container]
    	 * @returns {HTMLElement[]}
    	 */
    	function $$(selector, container) {
    		return Array.prototype.slice.call((container || document).querySelectorAll(selector));
    	}

    	/**
    	 * Returns whether the given element has the given class.
    	 *
    	 * @param {Element} element
    	 * @param {string} className
    	 * @returns {boolean}
    	 */
    	function hasClass(element, className) {
    		className = " " + className + " ";
    		return (" " + element.className + " ").replace(/[\n\t]/g, " ").indexOf(className) > -1
    	}

    	/**
    	 * Calls the given function.
    	 *
    	 * @param {() => any} func
    	 * @returns {void}
    	 */
    	function callFunction(func) {
    		func();
    	}

    	// Some browsers round the line-height, others don't.
    	// We need to test for it to position the elements properly.
    	var isLineHeightRounded = (function () {
    		var res;
    		return function () {
    			if (typeof res === 'undefined') {
    				var d = document.createElement('div');
    				d.style.fontSize = '13px';
    				d.style.lineHeight = '1.5';
    				d.style.padding = '0';
    				d.style.border = '0';
    				d.innerHTML = '&nbsp;<br />&nbsp;';
    				document.body.appendChild(d);
    				// Browsers that round the line-height should have offsetHeight === 38
    				// The others should have 39.
    				res = d.offsetHeight === 38;
    				document.body.removeChild(d);
    			}
    			return res;
    		}
    	}());

    	/**
    	 * Highlights the lines of the given pre.
    	 *
    	 * This function is split into a DOM measuring and mutate phase to improve performance.
    	 * The returned function mutates the DOM when called.
    	 *
    	 * @param {HTMLElement} pre
    	 * @param {string} [lines]
    	 * @param {string} [classes='']
    	 * @returns {() => void}
    	 */
    	function highlightLines(pre, lines, classes) {
    		lines = typeof lines === 'string' ? lines : pre.getAttribute('data-line');

    		var ranges = lines.replace(/\s+/g, '').split(',').filter(Boolean);
    		var offset = +pre.getAttribute('data-line-offset') || 0;

    		var parseMethod = isLineHeightRounded() ? parseInt : parseFloat;
    		var lineHeight = parseMethod(getComputedStyle(pre).lineHeight);
    		var hasLineNumbers = hasClass(pre, 'line-numbers');
    		var parentElement = hasLineNumbers ? pre : pre.querySelector('code') || pre;
    		var mutateActions = /** @type {(() => void)[]} */ ([]);

    		ranges.forEach(function (currentRange) {
    			var range = currentRange.split('-');

    			var start = +range[0];
    			var end = +range[1] || start;

    			/** @type {HTMLElement} */
    			var line = pre.querySelector('.line-highlight[data-range="' + currentRange + '"]') || document.createElement('div');

    			mutateActions.push(function () {
    				line.setAttribute('aria-hidden', 'true');
    				line.setAttribute('data-range', currentRange);
    				line.className = (classes || '') + ' line-highlight';
    			});

    			// if the line-numbers plugin is enabled, then there is no reason for this plugin to display the line numbers
    			if (hasLineNumbers && Prism.plugins.lineNumbers) {
    				var startNode = Prism.plugins.lineNumbers.getLine(pre, start);
    				var endNode = Prism.plugins.lineNumbers.getLine(pre, end);

    				if (startNode) {
    					var top = startNode.offsetTop + 'px';
    					mutateActions.push(function () {
    						line.style.top = top;
    					});
    				}

    				if (endNode) {
    					var height = (endNode.offsetTop - startNode.offsetTop) + endNode.offsetHeight + 'px';
    					mutateActions.push(function () {
    						line.style.height = height;
    					});
    				}
    			} else {
    				mutateActions.push(function () {
    					line.setAttribute('data-start', start);

    					if (end > start) {
    						line.setAttribute('data-end', end);
    					}

    					line.style.top = (start - offset - 1) * lineHeight + 'px';

    					line.textContent = new Array(end - start + 2).join(' \n');
    				});
    			}

    			mutateActions.push(function () {
    				// allow this to play nicely with the line-numbers plugin
    				// need to attack to pre as when line-numbers is enabled, the code tag is relatively which screws up the positioning
    				parentElement.appendChild(line);
    			});
    		});

    		var id = pre.id;
    		if (hasLineNumbers && id) {
    			// This implements linkable line numbers. Linkable line numbers use Line Highlight to create a link to a
    			// specific line. For this to work, the pre element has to:
    			//  1) have line numbers,
    			//  2) have the `linkable-line-numbers` class or an ascendant that has that class, and
    			//  3) have an id.

    			var linkableLineNumbersClass = 'linkable-line-numbers';
    			var linkableLineNumbers = false;
    			var node = pre;
    			while (node) {
    				if (hasClass(node, linkableLineNumbersClass)) {
    					linkableLineNumbers = true;
    					break;
    				}
    				node = node.parentElement;
    			}

    			if (linkableLineNumbers) {
    				if (!hasClass(pre, linkableLineNumbersClass)) {
    					// add class to pre
    					mutateActions.push(function () {
    						pre.className = (pre.className + ' ' + linkableLineNumbersClass).trim();
    					});
    				}

    				var start = parseInt(pre.getAttribute('data-start') || '1');

    				// iterate all line number spans
    				$$('.line-numbers-rows > span', pre).forEach(function (lineSpan, i) {
    					var lineNumber = i + start;
    					lineSpan.onclick = function () {
    						var hash = id + '.' + lineNumber;

    						// this will prevent scrolling since the span is obviously in view
    						scrollIntoView = false;
    						location.hash = hash;
    						setTimeout(function () {
    							scrollIntoView = true;
    						}, 1);
    					};
    				});
    			}
    		}

    		return function () {
    			mutateActions.forEach(callFunction);
    		};
    	}

    	var scrollIntoView = true;
    	function applyHash() {
    		var hash = location.hash.slice(1);

    		// Remove pre-existing temporary lines
    		$$('.temporary.line-highlight').forEach(function (line) {
    			line.parentNode.removeChild(line);
    		});

    		var range = (hash.match(/\.([\d,-]+)$/) || [, ''])[1];

    		if (!range || document.getElementById(hash)) {
    			return;
    		}

    		var id = hash.slice(0, hash.lastIndexOf('.')),
    			pre = document.getElementById(id);

    		if (!pre) {
    			return;
    		}

    		if (!pre.hasAttribute('data-line')) {
    			pre.setAttribute('data-line', '');
    		}

    		var mutateDom = highlightLines(pre, range, 'temporary ');
    		mutateDom();

    		if (scrollIntoView) {
    			document.querySelector('.temporary.line-highlight').scrollIntoView();
    		}
    	}

    	var fakeTimer = 0; // Hack to limit the number of times applyHash() runs

    	Prism.hooks.add('before-sanity-check', function (env) {
    		var pre = env.element.parentNode;
    		var lines = pre && pre.getAttribute('data-line');

    		if (!pre || !lines || !/pre/i.test(pre.nodeName)) {
    			return;
    		}

    		/*
    		 * Cleanup for other plugins (e.g. autoloader).
    		 *
    		 * Sometimes <code> blocks are highlighted multiple times. It is necessary
    		 * to cleanup any left-over tags, because the whitespace inside of the <div>
    		 * tags change the content of the <code> tag.
    		 */
    		var num = 0;
    		$$('.line-highlight', pre).forEach(function (line) {
    			num += line.textContent.length;
    			line.parentNode.removeChild(line);
    		});
    		// Remove extra whitespace
    		if (num && /^( \n)+$/.test(env.code.slice(-num))) {
    			env.code = env.code.slice(0, -num);
    		}
    	});

    	Prism.hooks.add('complete', function completeHook(env) {
    		var pre = env.element.parentNode;
    		var lines = pre && pre.getAttribute('data-line');

    		if (!pre || !lines || !/pre/i.test(pre.nodeName)) {
    			return;
    		}

    		clearTimeout(fakeTimer);

    		var hasLineNumbers = Prism.plugins.lineNumbers;
    		var isLineNumbersLoaded = env.plugins && env.plugins.lineNumbers;

    		if (hasClass(pre, 'line-numbers') && hasLineNumbers && !isLineNumbersLoaded) {
    			Prism.hooks.add('line-numbers', completeHook);
    		} else {
    			var mutateDom = highlightLines(pre, lines);
    			mutateDom();
    			fakeTimer = setTimeout(applyHash, 1);
    		}
    	});

    	window.addEventListener('hashchange', applyHash);
    	window.addEventListener('resize', function () {
    		var actions = $$('pre[data-line]').map(function (pre) {
    			return highlightLines(pre);
    		});
    		actions.forEach(callFunction);
    	});

    })();

    (function () {
    	if (typeof self === 'undefined' || !self.Prism || !self.document) {
    		return;
    	}

    	var Prism = window.Prism;

    	var LOADING_MESSAGE = 'Loading…';
    	var FAILURE_MESSAGE = function (status, message) {
    		return '✖ Error ' + status + ' while fetching file: ' + message;
    	};
    	var FAILURE_EMPTY_MESSAGE = '✖ Error: File does not exist or is empty';

    	var EXTENSIONS = {
    		'js': 'javascript',
    		'py': 'python',
    		'rb': 'ruby',
    		'ps1': 'powershell',
    		'psm1': 'powershell',
    		'sh': 'bash',
    		'bat': 'batch',
    		'h': 'c',
    		'tex': 'latex'
    	};

    	var STATUS_ATTR = 'data-src-status';
    	var STATUS_LOADING = 'loading';
    	var STATUS_LOADED = 'loaded';
    	var STATUS_FAILED = 'failed';

    	var SELECTOR = 'pre[data-src]:not([' + STATUS_ATTR + '="' + STATUS_LOADED + '"])'
    		+ ':not([' + STATUS_ATTR + '="' + STATUS_LOADING + '"])';

    	var lang = /\blang(?:uage)?-([\w-]+)\b/i;

    	/**
    	 * Sets the Prism `language-xxxx` or `lang-xxxx` class to the given language.
    	 *
    	 * @param {HTMLElement} element
    	 * @param {string} language
    	 * @returns {void}
    	 */
    	function setLanguageClass(element, language) {
    		var className = element.className;
    		className = className.replace(lang, ' ') + ' language-' + language;
    		element.className = className.replace(/\s+/g, ' ').trim();
    	}


    	Prism.hooks.add('before-highlightall', function (env) {
    		env.selector += ', ' + SELECTOR;
    	});

    	Prism.hooks.add('before-sanity-check', function (env) {
    		var pre = /** @type {HTMLPreElement} */ (env.element);
    		if (pre.matches(SELECTOR)) {
    			env.code = ''; // fast-path the whole thing and go to complete

    			pre.setAttribute(STATUS_ATTR, STATUS_LOADING); // mark as loading

    			// add code element with loading message
    			var code = pre.appendChild(document.createElement('CODE'));
    			code.textContent = LOADING_MESSAGE;

    			var src = pre.getAttribute('data-src');

    			var language = env.language;
    			if (language === 'none') {
    				// the language might be 'none' because there is no language set;
    				// in this case, we want to use the extension as the language
    				var extension = (/\.(\w+)$/.exec(src) || [, 'none'])[1];
    				language = EXTENSIONS[extension] || extension;
    			}

    			// set language classes
    			setLanguageClass(code, language);
    			setLanguageClass(pre, language);

    			// preload the language
    			var autoloader = Prism.plugins.autoloader;
    			if (autoloader) {
    				autoloader.loadLanguages(language);
    			}

    			// load file
    			var xhr = new XMLHttpRequest();
    			xhr.open('GET', src, true);
    			xhr.onreadystatechange = function () {
    				if (xhr.readyState == 4) {
    					if (xhr.status < 400 && xhr.responseText) {
    						// mark as loaded
    						pre.setAttribute(STATUS_ATTR, STATUS_LOADED);

    						// highlight code
    						code.textContent = xhr.responseText;
    						Prism.highlightElement(code);

    					} else {
    						// mark as failed
    						pre.setAttribute(STATUS_ATTR, STATUS_FAILED);

    						if (xhr.status >= 400) {
    							code.textContent = FAILURE_MESSAGE(xhr.status, xhr.statusText);
    						} else {
    							code.textContent = FAILURE_EMPTY_MESSAGE;
    						}
    					}
    				}
    			};
    			xhr.send(null);
    		}
    	});

    	Prism.plugins.fileHighlight = {
    		/**
    		 * Executes the File Highlight plugin for all matching `pre` elements under the given container.
    		 *
    		 * Note: Elements which are already loaded or currently loading will not be touched by this method.
    		 *
    		 * @param {ParentNode} [container=document]
    		 */
    		highlight: function highlight(container) {
    			var elements = (container || document).querySelectorAll(SELECTOR);

    			for (var i = 0, element; element = elements[i++];) {
    				Prism.highlightElement(element);
    			}
    		}
    	};

    	var logged = false;
    	/** @deprecated Use `Prism.plugins.fileHighlight.highlight` instead. */
    	Prism.fileHighlight = function () {
    		if (!logged) {
    			console.warn('Prism.fileHighlight is deprecated. Use `Prism.plugins.fileHighlight.highlight` instead.');
    			logged = true;
    		}
    		Prism.plugins.fileHighlight.highlight.apply(this, arguments);
    	};

    })();

    /* src/App.svelte generated by Svelte v3.24.1 */

    function create_default_slot_2(ctx) {
    	let t_value = `let b = 3;
function helloworld() {
	console.log("Hello World");
}
` + "";

    	let t;

    	return {
    		c() {
    			t = text(t_value);
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (40:0) <Prism showLineNumbers={true}>
    function create_default_slot_1(ctx) {
    	let t_value = `
	let b = 3;
function helloworld() {

	console.log("Hello World");

}
` + "";

    	let t;

    	return {
    		c() {
    			t = text(t_value);
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (88:0) <Prism data-line="3,5-8">
    function create_default_slot(ctx) {
    	let t_value = `
onMount(() => {
	if (normalizeWhiteSpace) {
		Prism.plugins.NormalizeWhitespace.setDefaults(normalizeWhiteSpaceConfig);
	}
});

afterUpdate(async () => {
	// code variable if they are using a prop
	if (fakeCodeEl && fakeCodeEl.innerHTML !== "") {
		code = fakeCodeEl.innerHTML.trim();
	}
	// We need to wait till everything been rendered before we can
	// call highlightAll and load all the plugins
	await tick();
	// This will make sure all the plugins are loaded
	// Prism.highlight will not do that
	Prism.highlightAll();
});
` + "";

    	let t;

    	return {
    		c() {
    			t = text(t_value);
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    function create_fragment$1(ctx) {
    	let h1;
    	let t1;
    	let p0;
    	let t3;
    	let h20;
    	let t5;
    	let prism0;
    	let t6;
    	let h21;
    	let t8;
    	let prism1;
    	let t9;
    	let h22;
    	let t11;
    	let prism2;
    	let t12;
    	let h23;
    	let t14;
    	let prism3;
    	let t15;
    	let h24;
    	let t17;
    	let prism4;
    	let t18;
    	let h25;
    	let t20;
    	let p1;
    	let t24;
    	let prism5;
    	let t25;
    	let h26;
    	let t27;
    	let p2;
    	let t29;
    	let prism6;
    	let current;

    	prism0 = new Prism_1({
    			props: {
    				$$slots: { default: [create_default_slot_2] },
    				$$scope: { ctx }
    			}
    		});

    	prism1 = new Prism_1({
    			props: {
    				showLineNumbers: true,
    				$$slots: { default: [create_default_slot_1] },
    				$$scope: { ctx }
    			}
    		});

    	prism2 = new Prism_1({
    			props: {
    				language: "c",
    				normalizeWhiteSpace: false,
    				code: `
	
	int b =3;
int c = 32;

`
    			}
    		});

    	prism3 = new Prism_1({
    			props: {
    				showLineNumbers: true,
    				language: "c",
    				code: `
	
	int b =3;
int c = 32;

`
    			}
    		});

    	prism4 = new Prism_1({ props: { code: /*code*/ ctx[0] } });

    	prism5 = new Prism_1({
    			props: {
    				"data-line": "3,5-8",
    				$$slots: { default: [create_default_slot] },
    				$$scope: { ctx }
    			}
    		});

    	prism6 = new Prism_1({
    			props: {
    				showLineNumbers: true,
    				language: "svelte",
    				"data-src": "./App.svelte"
    			}
    		});

    	return {
    		c() {
    			h1 = element("h1");
    			h1.textContent = "Examples";
    			t1 = space();
    			p0 = element("p");
    			p0.textContent = "This shows some simple examples of how to use sveltejs-prism plugin.";
    			t3 = space();
    			h20 = element("h2");
    			h20.textContent = "Javascript Language Simple";
    			t5 = space();
    			create_component(prism0.$$.fragment);
    			t6 = space();
    			h21 = element("h2");
    			h21.textContent = "Javascript With Line Numbers";
    			t8 = space();
    			create_component(prism1.$$.fragment);
    			t9 = space();
    			h22 = element("h2");
    			h22.textContent = "C language with line numbers no white space cleanup";
    			t11 = space();
    			create_component(prism2.$$.fragment);
    			t12 = space();
    			h23 = element("h2");
    			h23.textContent = "C language with line numbers with white space cleanup";
    			t14 = space();
    			create_component(prism3.$$.fragment);
    			t15 = space();
    			h24 = element("h2");
    			h24.textContent = "Example showing code can change every 3 seconds";
    			t17 = space();
    			create_component(prism4.$$.fragment);
    			t18 = space();
    			h25 = element("h2");
    			h25.textContent = "Example using prism plugin not supported out of the box.";
    			t20 = space();
    			p1 = element("p");

    			p1.innerHTML = `We are using the
  <a href="https://prismjs.com/plugins/line-highlight/">line highlight plugin</a>
  plugin which requires the data-line attribute to be passed in. Other plugins
  just require you to include the js after the component is imported`;

    			t24 = space();
    			create_component(prism5.$$.fragment);
    			t25 = space();
    			h26 = element("h2");
    			h26.textContent = "All the code above";
    			t27 = space();
    			p2 = element("p");
    			p2.textContent = "This uses the import plugin";
    			t29 = space();
    			create_component(prism6.$$.fragment);
    		},
    		m(target, anchor) {
    			insert(target, h1, anchor);
    			insert(target, t1, anchor);
    			insert(target, p0, anchor);
    			insert(target, t3, anchor);
    			insert(target, h20, anchor);
    			insert(target, t5, anchor);
    			mount_component(prism0, target, anchor);
    			insert(target, t6, anchor);
    			insert(target, h21, anchor);
    			insert(target, t8, anchor);
    			mount_component(prism1, target, anchor);
    			insert(target, t9, anchor);
    			insert(target, h22, anchor);
    			insert(target, t11, anchor);
    			mount_component(prism2, target, anchor);
    			insert(target, t12, anchor);
    			insert(target, h23, anchor);
    			insert(target, t14, anchor);
    			mount_component(prism3, target, anchor);
    			insert(target, t15, anchor);
    			insert(target, h24, anchor);
    			insert(target, t17, anchor);
    			mount_component(prism4, target, anchor);
    			insert(target, t18, anchor);
    			insert(target, h25, anchor);
    			insert(target, t20, anchor);
    			insert(target, p1, anchor);
    			insert(target, t24, anchor);
    			mount_component(prism5, target, anchor);
    			insert(target, t25, anchor);
    			insert(target, h26, anchor);
    			insert(target, t27, anchor);
    			insert(target, p2, anchor);
    			insert(target, t29, anchor);
    			mount_component(prism6, target, anchor);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const prism0_changes = {};

    			if (dirty & /*$$scope*/ 2) {
    				prism0_changes.$$scope = { dirty, ctx };
    			}

    			prism0.$set(prism0_changes);
    			const prism1_changes = {};

    			if (dirty & /*$$scope*/ 2) {
    				prism1_changes.$$scope = { dirty, ctx };
    			}

    			prism1.$set(prism1_changes);
    			const prism4_changes = {};
    			if (dirty & /*code*/ 1) prism4_changes.code = /*code*/ ctx[0];
    			prism4.$set(prism4_changes);
    			const prism5_changes = {};

    			if (dirty & /*$$scope*/ 2) {
    				prism5_changes.$$scope = { dirty, ctx };
    			}

    			prism5.$set(prism5_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(prism0.$$.fragment, local);
    			transition_in(prism1.$$.fragment, local);
    			transition_in(prism2.$$.fragment, local);
    			transition_in(prism3.$$.fragment, local);
    			transition_in(prism4.$$.fragment, local);
    			transition_in(prism5.$$.fragment, local);
    			transition_in(prism6.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(prism0.$$.fragment, local);
    			transition_out(prism1.$$.fragment, local);
    			transition_out(prism2.$$.fragment, local);
    			transition_out(prism3.$$.fragment, local);
    			transition_out(prism4.$$.fragment, local);
    			transition_out(prism5.$$.fragment, local);
    			transition_out(prism6.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(h1);
    			if (detaching) detach(t1);
    			if (detaching) detach(p0);
    			if (detaching) detach(t3);
    			if (detaching) detach(h20);
    			if (detaching) detach(t5);
    			destroy_component(prism0, detaching);
    			if (detaching) detach(t6);
    			if (detaching) detach(h21);
    			if (detaching) detach(t8);
    			destroy_component(prism1, detaching);
    			if (detaching) detach(t9);
    			if (detaching) detach(h22);
    			if (detaching) detach(t11);
    			destroy_component(prism2, detaching);
    			if (detaching) detach(t12);
    			if (detaching) detach(h23);
    			if (detaching) detach(t14);
    			destroy_component(prism3, detaching);
    			if (detaching) detach(t15);
    			if (detaching) detach(h24);
    			if (detaching) detach(t17);
    			destroy_component(prism4, detaching);
    			if (detaching) detach(t18);
    			if (detaching) detach(h25);
    			if (detaching) detach(t20);
    			if (detaching) detach(p1);
    			if (detaching) detach(t24);
    			destroy_component(prism5, detaching);
    			if (detaching) detach(t25);
    			if (detaching) detach(h26);
    			if (detaching) detach(t27);
    			if (detaching) detach(p2);
    			if (detaching) detach(t29);
    			destroy_component(prism6, detaching);
    		}
    	};
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let code = "let b = 4;";

    	setInterval(
    		() => {
    			$$invalidate(0, code = code == "let b = 4;" ? "let c = 323;" : "let b = 4;");
    			console.log("should notice change");
    		},
    		3000
    	);

    	return [code];
    }

    class App extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, {});
    	}
    }

    const app = new App({
      target: document.body,
    });

    return app;

}());
//# sourceMappingURL=bundle.js.map