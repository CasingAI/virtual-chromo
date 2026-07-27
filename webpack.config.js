'use strict'

const path = require('path')

/** @type {import('webpack').Configuration} */
module.exports = {
  entry: path.resolve(__dirname, 'public/jsproxy-src/index.vc.js'),
  output: {
    path: path.resolve(__dirname, 'public'),
    filename: 'bundle.built.js',
    iife: true,
  },
  mode: 'production',
  target: 'web',
  optimization: {
    minimize: true,
  },
}
