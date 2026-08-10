// Framework-agnostic domain layer shared by the mobile app, the web app and the
// worker. Nothing in here may import React, React Native or any DOM API.
export * from './theme';
export * from './data';
export * from './seed';
export * from './regions';
export { default as en } from './locales/en';
export { default as fr } from './locales/fr';

export const LOCALES = ['en', 'fr'];
