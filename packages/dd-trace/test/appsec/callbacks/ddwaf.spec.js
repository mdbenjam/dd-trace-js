'use strict'

const WAFCallback = require('../../../src/appsec/callbacks/ddwaf')
const Gateway = require('../../../src/appsec/gateway/engine')
const Reporter = require('../../../src/appsec/reporter')
const rules = require('../../../src/appsec/recommended.json')
const log = require('../../../src/log')

const DEFAULT_MAX_BUDGET = 5e3

describe('WAFCallback', () => {
  afterEach(() => {
    sinon.restore()
  })

  describe('loadDDWAF', () => {
    it('should instanciate DDWAF', () => {
      const result = WAFCallback.loadDDWAF(rules)

      expect(result).itself.to.respondTo('createContext')
      expect(result).itself.to.respondTo('dispose')
    })

    it('should log exceptions', () => {
      sinon.spy(log, 'error')

      const wafError = () => WAFCallback.loadDDWAF({})

      expect(wafError).to.throw('Invalid rules')

      expect(log.error).to.have.been
        .calledOnceWithExactly('AppSec could not load native package. In-app WAF features will not be available.')
    })
  })

  describe('constructor', () => {
    it('should parse rules', () => {
      const rules = {
        rules: [{
          conditions: [{
            parameters: {
              inputs: [{
                address: 'server.request.headers.no_cookies:user-agent'
              }, {
                address: 'server.request.uri.raw'
              }, {
                address: 'server.request.headers.no_cookies'
              }]
            }
          }, {
            parameters: {
              inputs: [{
                address: 'server.request.headers.no_cookies'
              }, {
                address: 'server.request.headers.no_cookies:user-agent'
              }, {
                address: 'server.request.uri.raw'
              }]
            }
          }]
        }, {
          conditions: [{
            parameters: {
              inputs: [{
                address: 'invalid_address'
              }, {
                address: 'server.request.headers.no_cookies'
              }, {
                address: 'server.request.headers.no_cookies:user-agent'
              }, {
                address: 'server.request.method'
              }]
            }
          }]
        }]
      }

      const ddwaf = {}

      sinon.stub(WAFCallback, 'loadDDWAF').returns(ddwaf)

      sinon.stub(WAFCallback.prototype, 'action').returns('result')

      sinon.stub(Gateway.manager, 'addSubscription')

      const waf = new WAFCallback(rules)

      expect(WAFCallback.loadDDWAF).to.have.been.calledOnceWithExactly(rules)
      expect(waf.ddwaf).to.equal(ddwaf)
      expect(waf.wafContextCache).to.be.an.instanceOf(WeakMap)

      expect(Gateway.manager.addSubscription).to.have.been.calledThrice

      const firstCall = Gateway.manager.addSubscription.firstCall.firstArg
      expect(firstCall).to.have.property('addresses').that.is.an('array').that.deep.equals([
        'server.request.headers.no_cookies'
      ])
      expect(firstCall).to.have.nested.property('callback.method').that.is.a('function')
      const callback = firstCall.callback

      const secondCall = Gateway.manager.addSubscription.secondCall.firstArg
      expect(secondCall).to.have.property('addresses').that.is.an('array').that.deep.equals([
        'server.request.uri.raw'
      ])
      expect(secondCall).to.have.property('callback').that.equals(callback)

      const thirdCall = Gateway.manager.addSubscription.thirdCall.firstArg
      expect(thirdCall).to.have.property('addresses').that.is.an('array').that.deep.equals([
        'server.request.method'
      ])
      expect(thirdCall).to.have.property('callback').that.equals(callback)

      const result = callback.method('params', 'store')
      expect(WAFCallback.prototype.action).to.have.been.calledOnceWithExactly('params', 'store')
      expect(WAFCallback.prototype.action).to.have.been.calledOn(waf)
      expect(result).to.equal('result')
    })
  })

  describe('methods', () => {
    let waf

    beforeEach(() => {
      sinon.stub(WAFCallback, 'loadDDWAF').returns({
        createContext: sinon.spy(() => ({
          run: sinon.stub().returns({ action: 'monitor', data: '[]' }),
          dispose: sinon.stub(),
          get disposed () {
            return this.dispose.called
          }
        })),
        dispose: sinon.stub()
      })

      waf = new WAFCallback(rules)
    })

    describe('action', () => {
      let store

      beforeEach(() => {
        store = new Map()

        store.set('context', {})

        sinon.stub(waf, 'applyResult')
      })

      it('should get wafContext from cache', () => {
        const wafContext = waf.ddwaf.createContext()

        waf.wafContextCache.set(store.get('context'), wafContext)

        waf.action({ a: 1, b: 2 }, store)

        expect(wafContext.run).to.have.been.calledOnceWithExactly({ a: 1, b: 2 }, DEFAULT_MAX_BUDGET)
        expect(waf.applyResult).to.have.been.calledOnceWithExactly({ action: 'monitor', data: '[]' }, store)
        expect(wafContext.dispose).to.have.been.calledOnce
      })

      it('should create wafContext and cache it', () => {
        waf.action({ a: 1, b: 2 }, store)

        expect(waf.ddwaf.createContext).to.have.been.calledOnce

        const key = store.get('context')
        const wafContext = waf.wafContextCache.get(key)

        expect(wafContext.run).to.have.been.calledOnceWithExactly({ a: 1, b: 2 }, DEFAULT_MAX_BUDGET)
        expect(waf.applyResult).to.have.been.calledOnceWithExactly({ action: 'monitor', data: '[]' }, store)
        expect(wafContext.dispose).to.have.been.calledOnce
      })

      it('should create wafContext and not cache it when no request context is found', () => {
        sinon.spy(waf.wafContextCache, 'set')

        const store = new Map()

        waf.action({ a: 1, b: 2 }, store)

        expect(waf.ddwaf.createContext).to.have.been.calledOnce
        expect(waf.wafContextCache.set).to.not.have.been.called
        expect(waf.applyResult).to.have.been.calledOnceWithExactly({ action: 'monitor', data: '[]' }, store)
        expect(waf.ddwaf.createContext.firstCall.returnValue.dispose).to.have.been.calledOnce
      })

      it('should create wafContext and not cache it when no store is passed', () => {
        sinon.spy(waf.wafContextCache, 'set')

        waf.action({ a: 1, b: 2 })

        expect(waf.ddwaf.createContext).to.have.been.calledOnce
        expect(waf.wafContextCache.set).to.not.have.been.called
        expect(waf.applyResult).to.have.been.calledOnceWithExactly({ action: 'monitor', data: '[]' }, undefined)
        expect(waf.ddwaf.createContext.firstCall.returnValue.dispose).to.have.been.calledOnce
      })

      it('should create wafContext and not cache it when found wafContext is disposed', () => {
        sinon.spy(waf.wafContextCache, 'set')

        const wafContext = waf.ddwaf.createContext()

        wafContext.dispose()

        waf.wafContextCache.set(store.get('context'), wafContext)

        waf.ddwaf.createContext.resetHistory()
        waf.wafContextCache.set.resetHistory()
        wafContext.dispose.resetHistory()

        sinon.stub(wafContext, 'disposed').get(() => true)

        waf.action({ a: 1, b: 2 }, store)

        expect(waf.ddwaf.createContext).to.have.been.calledOnce
        expect(waf.wafContextCache.set).to.not.have.been.called

        expect(wafContext.run).to.not.have.been.called
        expect(wafContext.dispose).to.not.have.been.called

        const newWafContext = waf.ddwaf.createContext.firstCall.returnValue
        expect(newWafContext.run).to.have.been.calledOnceWithExactly({ a: 1, b: 2 }, DEFAULT_MAX_BUDGET)
        expect(newWafContext.dispose).to.have.been.calledOnce

        expect(waf.applyResult).to.have.been.calledOnceWithExactly({ action: 'monitor', data: '[]' }, store)
      })

      it('should cast status code into string', () => {
        const wafContext = waf.ddwaf.createContext()

        waf.wafContextCache.set(store.get('context'), wafContext)

        waf.action({
          'string': '/test',
          'server.response.status': 404,
          'number': 1337,
          'object': {
            a: 1,
            b: '2'
          }
        }, store)

        expect(wafContext.run).to.have.been.calledOnceWithExactly({
          'string': '/test',
          'server.response.status': '404',
          'number': 1337,
          'object': {
            a: 1,
            b: '2'
          }
        }, DEFAULT_MAX_BUDGET)

        expect(wafContext.dispose).to.have.been.calledOnce
      })

      it('should catch and log exceptions', () => {
        sinon.spy(log, 'error')

        const err = new Error('Empty params')

        const wafContext = waf.ddwaf.createContext()

        wafContext.run.throws(err)

        waf.wafContextCache.set(store.get('context'), wafContext)

        expect(() => waf.action({ a: 1, b: 2 }, store)).to.not.throw()
        expect(wafContext.run).to.have.been.calledOnceWithExactly({ a: 1, b: 2 }, DEFAULT_MAX_BUDGET)
        expect(waf.applyResult).to.not.have.been.called
        expect(log.error).to.have.been.calledTwice
        expect(log.error.firstCall).to.have.been.calledWithExactly('Error while running the AppSec WAF')
        expect(log.error.secondCall).to.have.been.calledWithExactly(err)
        expect(wafContext.dispose).to.have.been.calledOnce
      })
    })

    describe('applyResult', () => {
      beforeEach(() => {
        sinon.stub(Reporter, 'reportAttack')
      })

      it('should call reporter with unparsed attacks when passed data', () => {
        const data = JSON.stringify([{
          rule: {
            id: 'ruleId',
            name: 'ruleName',
            tags: {
              type: 'ruleType',
              category: 'ruleCategory'
            }
          },
          rule_matches: [{
            not_relevant: true
          }, {
            not_relevant: true
          }, {
            operator: 'matchOperator',
            operator_value: 'matchOperatorValue',
            parameters: [{
              address: 'headers',
              key_path: ['user-agent', 0],
              value: 'arachni/v1',
              highlight: ['arachni/v']
            }, {
              address: 'url',
              key_path: [],
              value: '/wordpress?<script>',
              highlight: ['wordpress', '<script']
            }]
          }]
        }, {
          rule: {
            id: 'ua-1337-rx',
            name: 'Hacker rule',
            tags: {
              type: 'user-agent',
              category: 'hacker'
            }
          },
          rule_matches: [{
            operator: 'is_sqli',
            operator_value: '',
            parameters: [{
              address: 'url',
              key_path: [],
              value: '/PG_SLEEP 1',
              highlight: []
            }]
          }]
        }])

        const store = new Map()

        waf.applyResult({ data }, store)

        expect(Reporter.reportAttack).to.have.been.calledOnceWithExactly(data, store)
      })

      it('should do nothing when passed empty data', () => {
        waf.applyResult({})
        waf.applyResult({ data: '[]' })

        expect(Reporter.reportAttack).to.not.have.been.called
      })
    })

    describe('clear', () => {
      it('should clear the context', () => {
        sinon.stub(Gateway.manager, 'clear')

        waf.wafContextCache.set(waf, {})

        waf.clear()

        expect(waf.ddwaf.dispose).to.have.been.calledOnce
        expect(waf.wafContextCache.get(waf)).to.be.undefined
        expect(Gateway.manager.clear).to.have.been.calledOnce
      })
    })
  })
})
