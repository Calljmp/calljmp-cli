import { describe, it, expect } from 'vitest';
import { toCamelCase, toKebabCase, toSentenceCase } from './case';

describe('case utils', () => {
  describe('toKebabCase', () => {
    it('should convert a string to kebab-case', () => {
      expect(toKebabCase('Hello World')).toBe('hello-world');
      expect(toKebabCase('helloWorld')).toBe('hello-world');
      expect(toKebabCase('HelloWorldTest')).toBe('hello-world-test');
      expect(toKebabCase('hello_world_test')).toBe('hello-world-test');
    });
  });

  describe('toSentenceCase', () => {
    it('should convert a string to Sentence case', () => {
      expect(toSentenceCase('hello world')).toBe('Hello world');
      expect(toSentenceCase('HelloWorld')).toBe('Hello world');
      expect(toSentenceCase('hello_world_test')).toBe('Hello world test');
      expect(toSentenceCase('HELLO WORLD TEST')).toBe('Hello world test');
    });
  });

  describe('toCamelCase', () => {
    it('should convert a string to camelCase', () => {
      expect(toCamelCase('Hello World')).toBe('helloWorld');
      expect(toCamelCase('hello-world')).toBe('helloWorld');
      expect(toCamelCase('Hello_World_Test')).toBe('helloWorldTest');
      expect(toCamelCase('hello_world_test')).toBe('helloWorldTest');
    });
  });
});
