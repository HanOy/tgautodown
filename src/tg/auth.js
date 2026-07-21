import { log } from '../logger/index.js';

let codeResolver = null;
let codeRejecter = null;
let pwdResolver = null;
let pwdRejecter = null;

export function waitForLoginCode() {
  return new Promise((resolve, reject) => {
    codeResolver = resolve;
    codeRejecter = reject;
  });
}

export function submitLoginCode(code) {
  if (codeResolver) {
    codeResolver(code);
    codeResolver = null;
    codeRejecter = null;
  } else {
    log.warn('no pending login code handler');
  }
}

export function waitFor2faPassword() {
  return new Promise((resolve, reject) => {
    pwdResolver = resolve;
    pwdRejecter = reject;
  });
}

export function submit2faPassword(pwd) {
  if (pwdResolver) {
    pwdResolver(pwd);
    pwdResolver = null;
    pwdRejecter = null;
  } else {
    log.warn('no pending 2fa handler');
  }
}

export function cancelLogin(reason) {
  const err = new Error(reason || 'login cancelled');
  if (codeRejecter) {
    codeRejecter(err);
    codeResolver = null;
    codeRejecter = null;
  }
  if (pwdRejecter) {
    pwdRejecter(err);
    pwdResolver = null;
    pwdRejecter = null;
  }
}