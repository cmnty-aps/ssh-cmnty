import { h, render } from 'preact';
import { App } from './components/app';
import './style/index.scss';

const container = document.getElementById('root') || document.body;
render(<App />, container);
