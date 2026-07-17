export function greet(name: string): string {
  return `Hello, ${name}!`
}

export function add(a: number, b: number): number {
  return a + b
}

export function multiply(a: number, b: number): number {
  return a * b
}

export * from './core/mqtt'

export default {
  greet,
  add,
  multiply,
}
