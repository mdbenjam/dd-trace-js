const Plugin = require('../../dd-trace/src/plugins/plugin')
const { storage } = require('../../datadog-core')

const {
  CI_APP_ORIGIN,
  TEST_STATUS,
  JEST_TEST_RUNNER,
  finishAllTraceSpans,
  getTestEnvironmentMetadata,
  getTestParentSpan,
  getTestCommonTags,
  TEST_PARAMETERS
} = require('../../dd-trace/src/plugins/util/test')

function getTestSpanMetadata (tracer, test) {
  const childOf = getTestParentSpan(tracer)

  const { suite, name, runner, testParameters } = test

  const commonTags = getTestCommonTags(name, suite, tracer._version)

  return {
    childOf,
    ...commonTags,
    [JEST_TEST_RUNNER]: runner,
    [TEST_PARAMETERS]: testParameters
  }
}

class JestPlugin extends Plugin {
  static get name () {
    return 'jest'
  }

  constructor (...args) {
    super(...args)

    this.testEnvironmentMetadata = getTestEnvironmentMetadata('jest', this.config)

    this.addSub('ci:jest:test:start', (test) => {
      const store = storage.getStore()
      const span = this.startTestSpan(test)

      this.enter(span, store)
    })

    this.addSub('ci:jest:test:end', (status) => {
      const span = storage.getStore().span
      span.setTag(TEST_STATUS, status)
      span.finish()
      finishAllTraceSpans(span)
      this.exit()
    })

    this.addSub('ci:jest:test-suite:end', () => {
      this.tracer._exporter._writer.flush()
    })

    this.addSub('ci:jest:test:err', (error) => {
      if (error) {
        const span = storage.getStore().span
        span.setTag(TEST_STATUS, 'fail')
        span.setTag('error', error)
      }
    })

    this.addSub('ci:jest:test:skip', (test) => {
      const span = this.startTestSpan(test)
      span.setTag(TEST_STATUS, 'skip')
      span.finish()
    })
  }

  startTestSpan (test) {
    const { childOf, ...testSpanMetadata } = getTestSpanMetadata(this.tracer, test)

    const testSpan = this.tracer
      .startSpan('jest.test', {
        childOf,
        tags: {
          ...this.testEnvironmentMetadata,
          ...testSpanMetadata
        }
      })

    testSpan.context()._trace.origin = CI_APP_ORIGIN

    return testSpan
  }
}

module.exports = JestPlugin
