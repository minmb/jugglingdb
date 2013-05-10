/**
 * Dependencies
 */
var i8n = require('inflection');
var _ = require('underscore');
var defineScope = require('./scope.js').defineScope;

/**
 * Relations mixins for ./model.js
 */
var Model = require('./model.js');

Model.relationNameFor = function relationNameFor(foreignKey) {
    for (var rel in this.relations) {
        if (this.relations[rel].type === 'belongsTo' && this.relations[rel].keyFrom === foreignKey) {
            return rel;
        }
    }
};

/**
 * Declare hasMany relation
 *
 * @param {Model} anotherClass - class to has many
 * @param {Object} params - configuration {as:, foreignKey:}
 * @example `User.hasMany(Post, {as: 'posts', foreignKey: 'authorId'});`
 */
Model.hasMany = function hasMany(anotherClass, params) {
    var thisClass = this, thisClassName = this.modelName;
    params = params || {};
    if (typeof anotherClass === 'string') {
        params.as = anotherClass;
        if (params.model) {
            anotherClass = params.model;
        } else {
            var anotherClassName = i8n.singularize(anotherClass).toLowerCase();
            for(var name in this.schema.models) {
                if (name.toLowerCase() === anotherClassName) {
                    anotherClass = this.schema.models[name];
                }
            }
        }
    }
    var methodName = params.as ||
        i8n.camelize(i8n.pluralize(anotherClass.modelName), true);
    var fk = params.foreignKey || i8n.camelize(thisClassName + '_id', true);

    this.relations[methodName] = {
        type: 'hasMany',
        keyFrom: 'id',
        keyTo: fk,
        modelTo: anotherClass,
        multiple: true
    };
    // each instance of this class should have method named
    // pluralize(anotherClass.modelName)
    // which is actually just anotherClass.all({where: {thisModelNameId: this.id}}, cb);
    var scopeMethods = {
        find: find,
        destroy: destroy
    };
    if (params.through) {
        var fk2 = i8n.camelize(anotherClass.modelName + '_id', true);
        scopeMethods.create = function create(data, done) {
            if (typeof data !== 'object') {
                done = data;
                data = {};
            }
            if ('function' !== typeof done) {
                done = function() {};
            }
            var self = this;
            var id = this.id;
            anotherClass.create(data, function(err, ac) {
                if (err) return done(err, ac);
                var d = {};
                d[params.through.relationNameFor(fk)] = self;
                d[params.through.relationNameFor(fk2)] = ac;
                params.through.create(d, function(e) {
                    if (e) {
                        ac.destroy(function() {
                            done(e);
                        });
                    } else {
                        done(err, ac);
                    }
                });
            });
        };
        scopeMethods.add = function(acInst, done) {
            var data = {};
            var query = {};
            query[fk] = this.id;
            data[params.through.relationNameFor(fk)] = this;
            query[fk2] = acInst.id || acInst;
            data[params.through.relationNameFor(fk2)] = acInst;
            params.through.findOrCreate({where: query}, data, done);
        };
        scopeMethods.remove = function(acInst, done) {
            var self = this;
            var q = {};
            q[fk2] = acInst.id || acInst;
            params.through.findOne({where: q}, function(err, d) {
                if (err) {
                    return done(err);
                }
                if (!d) {
                    return done();
                }
                d.destroy(done);
            });
        };
        delete scopeMethods.destroy;
    }
    defineScope(this.prototype, params.through || anotherClass, methodName, function () {
        var filter = {};
        filter.where = {};
        filter.where[fk] = this.id;
        if (params.through) {
            filter.collect = i8n.camelize(anotherClass.modelName, true);
            filter.include = filter.collect;
        }
        return filter;
    }, scopeMethods);

    if (!params.through) {
        // obviously, anotherClass should have attribute called `fk`
        anotherClass.schema.defineForeignKey(anotherClass.modelName, fk, this.modelName);
    }

    function find(id, cb) {
        anotherClass.find(id, function (err, inst) {
            if (err) return cb(err);
            if (!inst) return cb(new Error('Not found'));
            if (inst[fk] && inst[fk].toString() == this.id.toString()) {
                cb(null, inst);
            } else {
                cb(new Error('Permission denied'));
            }
        }.bind(this));
    }

    function destroy(id, cb) {
        this.find(id, function (err, inst) {
            if (err) return cb(err);
            if (inst) {
                inst.destroy(cb);
            } else {
                cb(new Error('Not found'));
            }
        });
    }

};

/**
 * Declare belongsTo relation
 *
 * @param {Class} anotherClass - class to belong
 * @param {Object} params - configuration {as: 'propertyName', foreignKey: 'keyName'}
 *
 * **Usage examples**
 * Suppose model Post have a *belongsTo* relationship with User (the author of the post). You could declare it this way:
 * Post.belongsTo(User, {as: 'author', foreignKey: 'userId'});
 *
 * When a post is loaded, you can load the related author with:
 * post.author(function(err, user) {
 *     // the user variable is your user object
 * });
 *
 * The related object is cached, so if later you try to get again the author, no additional request will be made.
 * But there is an optional boolean parameter in first position that set whether or not you want to reload the cache:
 * post.author(true, function(err, user) {
 *     // The user is reloaded, even if it was already cached.
 * });
 *
 * This optional parameter default value is false, so the related object will be loaded from cache if available.
 */
Model.belongsTo = function (anotherClass, params) {
    params = params || {};
    if ('string' === typeof anotherClass) {
        params.as = anotherClass;
        if (params.model) {
            anotherClass = params.model;
        } else {
            var anotherClassName = anotherClass.toLowerCase();
            for(var name in this.schema.models) {
                if (name.toLowerCase() === anotherClassName) {
                    anotherClass = this.schema.models[name];
                }
            }
        }
    }
    var methodName = params.as || i8n.camelize(anotherClass.modelName, true);
    var fk = params.foreignKey || methodName + 'Id';

    this.relations[methodName] = {
        type: 'belongsTo',
        keyFrom: fk,
        keyTo: 'id',
        modelTo: anotherClass,
        multiple: false
    };

    this.schema.defineForeignKey(this.modelName, fk, anotherClass.modelName);
    this.prototype['__finders__'] = this.prototype['__finders__'] || {};

    this.prototype['__finders__'][methodName] = function (id, cb) {
        if (id === null) {
            cb(null, null);
            return;
        }
        anotherClass.find(id, function (err,inst) {
            if (err) return cb(err);
            if (!inst) return cb(null, null);
            if (inst.id === this[fk]) {
                cb(null, inst);
            } else {
                cb(new Error('Permission denied'));
            }
        }.bind(this));
    };

    this.prototype[methodName] = function (refresh, p) {
        if (arguments.length === 1) {
            p = refresh;
            refresh = false;
        } else if (arguments.length > 2) {
            throw new Error('Method can\'t be called with more than two arguments');
        }
        var self = this;
        var cachedValue;
        if (!refresh && this.__cachedRelations && (typeof this.__cachedRelations[methodName] !== 'undefined')) {
            cachedValue = this.__cachedRelations[methodName];
        }
        if (p instanceof Model) { // acts as setter
            this[fk] = p.id;
            this.__cachedRelations[methodName] = p;
        } else if (typeof p === 'function') { // acts as async getter
            if (typeof cachedValue === 'undefined') {
                this.__finders__[methodName].apply(self, [this[fk], function(err, inst) {
                    if (!err) {
                        self.__cachedRelations[methodName] = inst;
                    }
                    p(err, inst);
                }]);
                return this[fk];
            } else {
                p(null, cachedValue);
                return cachedValue;
            }
        } else if (typeof p === 'undefined') { // acts as sync getter
            return this[fk];
        } else { // setter
            this[fk] = p;
            delete this.__cachedRelations[methodName];
        }
    };

};

/**
 * Many-to-many relation
 *
 * Post.hasAndBelongsToMany('tags'); creates connection model 'PostTag'
 */
Model.hasAndBelongsToMany = function hasAndBelongsToMany(anotherClass, params) {
    params = params || {};
    var models = this.schema.models;

    if ('string' === typeof anotherClass) {
        params.as = anotherClass;
        if (params.model) {
            anotherClass = params.model;
        } else {
            anotherClass = lookupModel(i8n.singularize(anotherClass)) ||
                anotherClass;
        }
        if (typeof anotherClass === 'string') {
            throw new Error('Could not find "' + anotherClass + '" relation for ' + this.modelName);
        }
    }

    if (!params.through) {
        var name1 = this.modelName + anotherClass.modelName;
        var name2 = anotherClass.modelName + this.modelName;
        params.through = lookupModel(name1) || lookupModel(name2) ||
            this.schema.define(name1);
    }
    params.through.belongsTo(this);
    params.through.belongsTo(anotherClass);

    this.hasMany(anotherClass, {as: params.as, through: params.through});

    function lookupModel(modelName) {
        var lookupClassName = modelName.toLowerCase();
        for (var name in models) {
            if (name.toLowerCase() === lookupClassName) {
                return models[name];
            }
        }
    }

};

/**
 * hasOne/belongsTo embedded relation
 *
 * Post.embedsOne('author');
 */

Model.embedsOne = function embedsOne(anotherClass, params) {

    params = params || {};
    var models = this.schema.models;

    if ('string' === typeof anotherClass) {
        params.as = anotherClass;
        if (params.model) {
            anotherClass = params.model;
        } else {
            anotherClass = lookupModel(i8n.singularize(anotherClass)) ||
                anotherClass;
        }
        if (typeof anotherClass === 'string') {
            throw new Error('Could not find "' + anotherClass + '" relation for ' + this.modelName);
        }
    }

    var methodName = params.as || i8n.camelize(anotherClass.modelName, true);
    var fk = params.foreignKey || methodName + 'Id';

    this.relations[methodName] = {
        type: 'embedsOne',
        modelTo: anotherClass,
        multiple: false,
        keyFrom: fk,
        keyTo: 'id'
    };

    this.prototype[methodName] = function (p) {

        if (arguments.length > 1) {
            throw new Error('Method can\'t be called with more than one argument');
        }

        var inst = null;

        if (this.__rawData.hasOwnProperty(methodName)) {
            inst = new anotherClass(this.__rawData[methodName]);
        }

        if (p instanceof Model) { // acts as setter
            this.__rawData[methodName] = p.__rawData;
        } else if (typeof p === 'function') { // acts as async getter
            p(null, inst);
        } else if (typeof p === 'undefined') { // acts as sync getter
            return inst;
        } else { // setter
            this.__rawData[methodName] = p;
        }

    };

    function lookupModel(modelName) {
        var lookupClassName = modelName.toLowerCase();
        for (var name in models) {
            if (name.toLowerCase() === lookupClassName) {
                return models[name];
            }
        }
    }

};

/**
 * hasMany embedded relation
 *
 * Post.embedsMany('comments');
 */

Model.embedsMany = function embedsMany(anotherClass, params) {

    params = params || {};
    var models = this.schema.models;

    if ('string' === typeof anotherClass) {
        params.as = anotherClass;
        if (params.model) {
            anotherClass = params.model;
        } else {
            anotherClass = lookupModel(i8n.singularize(anotherClass)) ||
                anotherClass;
        }
        if (typeof anotherClass === 'string') {
            throw new Error('Could not find "' + anotherClass + '" relation for ' + this.modelName);
        }
    }

    var methodName = params.as ||
        i8n.camelize(i8n.pluralize(anotherClass.modelName), true);
    var fk = params.foreignKey || i8n.camelize(this.modelName + '_id', true);

    this.relations[methodName] = {
        type: 'embedsMany',
        modelTo: anotherClass,
        multiple: true,
        keyFrom: 'id',
        keyTo: fk
    };

    if (!this.prototype._scopeMeta) {
        this.prototype._scopeMeta = {};
    }

    if (this.prototype === anotherClass) {
        this.prototype._scopeMeta[name] = params;
    } else {
        if (!anotherClass._scopeMeta) {
            anotherClass._scopeMeta = {};
        }
    }

    Object.defineProperty(this.prototype, methodName, {
        enumerable: false,
        configurable: true,
        get: function  () {
            var f = function caller(params, cb) {
                
                if (typeof params === 'function') { // f(function() { })
                    cb = params;
                    all.call(this, cb);
                } else if (typeof cb !== 'undefined') { // f({}, function() { })
                    all.call(this, params, cb);
                } else if (typeof params !== 'undefined') { // f({})
                    return all.call(this, params);
                } else { // f()
                    return all.call(this);
                }
            };

            f._scope = {where: {}};
            f._scope.where[fk] = this.id;

            f.all = all.bind(this);
            f.find = find.bind(this);
            f.destroy = destroy.bind(this);
            f.build = build;
            f.create = create;
            f.destroyAll = destroyAll;

            Object.keys(anotherClass._scopeMeta).forEach(function (name) {
                Object.defineProperty(f, name, {
                    enumerable: false,
                    get: function () {
                        _.extend(f._scope, anotherClass._scopeMeta[name]);
                        return f;
                    }
                });
            }.bind(this));
            return f;
        }
    });

    function all(params, cb) {

        if (arguments.length < 2) {
            cb = params;
            params = {};
        }

        var data = this.__rawData[methodName];

        if (params.where) {
            data = _.where(data, params.where);
        }

        if (params.order) {
            var order = params.order.split(/\s+/),
                orderField = order[0],
                orderDirection = order[1];

            data = sortBy(data, orderField, orderDirection);
        }

        var coll = _.map(data, function(obj) {
            return new anotherClass(obj);  
        });

        if (cb) {
            cb(null, coll);
        } else {
            return coll;
        } 
    }

    function build(data) {
        var where = _.clone(this._scope).where || {};

        if (data) {
            _.extend(where, data);
        }

        return new anotherClass(where);
    }

    function create(data, cb) {
        if (typeof data === 'function') {
            cb = data;
            data = {};
        }
        this.build(data).save(cb);
    }

    function destroyAll(cb) {
        this.all(this._scope, function (err, data) {
            if (err) {
                cb(err);
            } else {
                (function loopOfDestruction (data) {
                    if(data.length > 0) {
                        data.shift().destroy(function(err) {
                            if(err && cb) cb(err);
                            loopOfDestruction(data);
                        });
                    } else {
                        if(cb) cb();
                    }
                }(data));
            }
        });
    }

    function find(id, cb) {
        var inst = _.findWhere(this.__rawData[methodName], {id: id});

        if (inst) {
            if (cb) {
                cb(null, new anotherClass(inst));    
            } else {
                return new anotherClass(inst);
            }
        } else {
            if (cb) {
                cb(new Error('Not found'));
            } else {
                return null;
            }
        }
    }

    function destroy(id, cb) {
        this.find(id, function (err, inst) {
            if (err) return cb(err);
            if (inst) {
                inst.destroy(cb);
            } else {
                cb(new Error('Not found'));
            }
        });
    }

    function lookupModel(modelName) {
        var lookupClassName = modelName.toLowerCase();
        for (var name in models) {
            if (name.toLowerCase() === lookupClassName) {
                return models[name];
            }
        }
    }

};

function sortBy(obj, value, context, direction) {

    if (typeof context === 'string') {
        direction = context;
        context = undefined;
    }

    var iterator = _.isFunction(value) ? value : function(obj){ return obj[value]; };

    return _.pluck(_.map(obj, function(value, index, list) {
        return {
            value : value,
            index : index,
            criteria : iterator.call(context, value, index, list)
        };
    }).sort(function(left, right) {
        var a = left.criteria;
        var b = right.criteria;

        if (direction === 'DESC') {
            a = right.criteria;
            b = left.criteria;
        }

        if (a !== b) {
            if (a > b || a === void 0) return 1;
            if (a < b || b === void 0) return -1;
        }
        return left.index < right.index ? -1 : 1;
    }), 'value');

}
