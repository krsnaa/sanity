import pify from 'pify'
import httpRequest from './httpRequest'
import gradient from '@sanity/gradient-client'
import validators from './validators'

const tokenHeader = 'Sanity-Token'
const projectHeader = 'Sanity-Project-ID'
const allowedEvents = ['request']
const defaultConfig = {
  apiHost: 'https://api.sanity.io',
  useProjectHostname: true
}

const verifyEvent = (event, handler) => {
  if (allowedEvents.indexOf(event) === -1) {
    throw new Error(`Unknown event type "${event}"`)
  }

  if (typeof handler !== 'function') {
    throw new Error('Event handler must be a function')
  }
}

const initConfig = (config, prevConfig = {}) => {
  const newConfig = {...defaultConfig, ...prevConfig, ...config}
  if (!newConfig.projectId) {
    throw new Error('Configuration must contain `projectId`')
  }

  if (!/^[-a-f0-9]+$/.test(newConfig.projectId)) {
    throw new Error('`projectId` must start with a number')
  }

  const [protocol, host] = newConfig.apiHost.split('://', 2)
  if (newConfig.useProjectHostname) {
    newConfig.url = `${protocol}://${newConfig.projectId}.${host}/v1`
  } else {
    newConfig.url = `${newConfig.apiHost}/v1`
  }

  return newConfig
}

const getGradientConfig = config => ({
  url: `${config.url}/data`,
  dataset: config.dataset
})

const getReqOptions = config => {
  const headers = {}

  if (config.token) {
    headers[tokenHeader] = config.token
  }

  if (!config.useProjectHostname) {
    headers[projectHeader] = config.projectId
  }

  return {headers, json: true}
}

class SanityClient {
  constructor(config = defaultConfig) {
    this.clientConfig = initConfig(config)
    const client = this.gradientClient = gradient(getGradientConfig(this.clientConfig))

    this.eventHandlers = allowedEvents.reduce((handlers, event) => {
      handlers[event] = []
      return handlers
    }, {})

    this.gradient = pify({
      fetch: client.fetch.bind(client),
      update: client.update.bind(client),
      create: client.create.bind(client),
      delete: client.delete.bind(client)
    })
  }

  config(newConfig) {
    if (typeof newConfig === 'undefined') {
      return this.clientConfig
    }

    this.clientConfig = initConfig(newConfig, this.clientConfig)
    const gradientConfig = getGradientConfig(this.clientConfig)
    return this.gradientClient.setConfig(gradientConfig) && this
  }

  on(event, handler) {
    verifyEvent(event, handler)
    this.eventHandlers[event].push(handler)
    return this
  }

  removeListener(event, handler) {
    verifyEvent(event, handler)
    const handlerIndex = this.eventHandlers[event].indexOf(handler)
    if (handlerIndex === -1) {
      throw new Error('Event handler given is not registered for this event')
    }

    this.eventHandlers[event].splice(handlerIndex, 1)
    return this
  }

  emit(event, ...args) {
    const handlers = this.eventHandlers[event] || []
    return handlers.length
      ? Promise.all(handlers.map(handler => handler(...args)))
      : Promise.resolve()
  }

  dataRequest(method, ...args) {
    return this.emit('request', method, ...args)
      .then(() => this.gradient[method](...args, getReqOptions(this.clientConfig)))
  }

  fetch(query, params) {
    return this.dataRequest('fetch', query, params)
  }

  update(documentId, patch) {
    return this.dataRequest('update', documentId, patch)
  }

  create(doc) {
    return this.dataRequest('create', doc)
  }

  delete(documentId) {
    return this.dataRequest('delete', documentId)
  }

  modifyDataset(method, name) {
    validators.dataset(name)
    return this.request({method, uri: `/datasets/${name}`})
  }

  createDataset(name) {
    return this.modifyDataset('PUT', name)
  }

  deleteDataset(name) {
    return this.modifyDataset('DELETE', name)
  }

  getProjects() {
    return this.request({uri: '/projects'})
  }

  request(options) {
    return httpRequest({
      ...getReqOptions(this.clientConfig),
      ...options,
      uri: `${this.clientConfig.url}/${options.uri.replace(/^\//, '')}`
    })
  }
}

function createClient(config) {
  return new SanityClient(config)
}

export default createClient
