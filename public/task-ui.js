(function (global) {
  function isBlockedTaskResponse(body) {
    const task = body?.task;
    return Boolean(task && (task.status === 'blocked' || task.status === 'unavailable') && typeof task.goal === 'string' && typeof (task.blockedReason || task.lastError) === 'string');
  }

  const api = { isBlockedTaskResponse };
  global.KCTaskUi = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);