export const $ = selector => document.querySelector(selector);

export function create(tag, className = '', value = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = value;
  return node;
}

export function button(label, className, action) {
  const node = create('button', className, label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
