// note (harry): These constants are injected at build time by Vite
declare const __PACKAGE_VERSION__: string
declare const __PACKAGE_NAME__: string

export const PACKAGE_VERSION = __PACKAGE_VERSION__
export const PACKAGE_NAME = __PACKAGE_NAME__
