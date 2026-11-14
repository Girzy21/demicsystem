/* 2>nul
@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [GAGAL] Node.js tidak ditemukan di PATH. Pasang Node.js lalu coba lagi.
  pause
  exit /b 1
)
set "W3_TMP=%TEMP%\w3study-update2.cjs"
copy /y "%~f0" "%W3_TMP%" >nul
node "%W3_TMP%"
set "W3_CODE=%ERRORLEVEL%"
del "%W3_TMP%" >nul 2>nul
pause
exit /b %W3_CODE%
*/
const fs = require("fs");
const { spawnSync } = require("child_process");
const path = require("path");

const PAYLOAD = {
  "admin_setup_5_sql": "LS0gdzNzdHVkeSB1cGRhdGUgMjogdG9waWsgYmF3YWFuIHlhbmcgZGloYXB1cyBhZG1pbgotLSBKYWxhbmthbiBzZWthbGkgZGkgU3VwYWJhc2UgPiBTUUwgRWRpdG9yLgotLQotLSBUb3BpayBiYXdhYW4gKGRhZnRhciBkaSBzcmMvbGliL2ZvbGRlclRyZWUuanMpIHRpZGFrIHRlcnNpbXBhbiBkaSBkYXRhYmFzZSwgamFkaQotLSAibWVuZ2hhcHVzIiB0b3BpayBiYXdhYW4gPSBtZW5jYXRhdG55YSBkaSBzaW5pIHN1cGF5YSBmb2xkZXJueWEgZGlzZW1idW55aWthbiBkYXJpIHNpc3dhCi0tIGRhbiBkYXJpIHBpbGloYW4gdG9waWsgc2FhdCB1cGxvYWQuIEJhcmlzIGRpaGFwdXMgPSB0b3BpayBkaXB1bGloa2FuLgotLSBUb3BpayBidWF0YW4gcGVuZ2d1bmEgdGlkYWsgYnV0dWggdGFiZWwgaW5pOiBpYSBoaWxhbmcgc2VuZGlyaSBiZWdpdHUgaXNpbnlhIGRpcGluZGFoa2FuLgoKY3JlYXRlIHRhYmxlIGlmIG5vdCBleGlzdHMgcHVibGljLnJlbW92ZWRfdG9waWNzICgKICBzdWJqZWN0ICAgIHRleHQgbm90IG51bGwsCiAgdG9waWMgICAgICB0ZXh0IG5vdCBudWxsLAogIHJlbW92ZWRfYnkgdGV4dCwKICByZW1vdmVkX2F0IHRpbWVzdGFtcHR6IG5vdCBudWxsIGRlZmF1bHQgbm93KCksCiAgcHJpbWFyeSBrZXkgKHN1YmplY3QsIHRvcGljKQopOwphbHRlciB0YWJsZSBwdWJsaWMucmVtb3ZlZF90b3BpY3MgZW5hYmxlIHJvdyBsZXZlbCBzZWN1cml0eTsKcmV2b2tlIGFsbCBvbiBwdWJsaWMucmVtb3ZlZF90b3BpY3MgZnJvbSBhbm9uLCBhdXRoZW50aWNhdGVkOwpncmFudCBhbGwgb24gcHVibGljLnJlbW92ZWRfdG9waWNzIHRvIHNlcnZpY2Vfcm9sZTsKCm5vdGlmeSBwZ3JzdCwgJ3JlbG9hZCBzY2hlbWEnOwo=",
  "admin_topics_remove_route": "Ly8gUE9TVCAvYXBpL2FkbWluL3RvcGljcy9yZW1vdmUKLy8gICB7IHN1YmplY3QsIHRvcGljLCBtb3ZlVG8/OiB7IHN1YmplY3QsIHRvcGljIH0sIHJlYXNvbj8gfSAgLT4gaGFwdXMgdG9waWsKLy8gICB7IHN1YmplY3QsIHRvcGljLCByZXN0b3JlOiB0cnVlIH0gICAgICAgICAgICAgICAgICAgICAgICAgIC0+IHB1bGloa2FuIHRvcGlrIGJhd2FhbiB5YW5nIHBlcm5haCBkaWhhcHVzCi8vCi8vIEF0dXJhbjoKLy8gIC0gVG9waWsgeWFuZyBtYXNpaCBiZXJpc2kgbW9kdWwvcG9zdCBUSURBSyBiaXNhIGRpaGFwdXMgYmVnaXR1IHNhamE6IGFkbWluIHdhamliIG1lbWlsaWggdG9waWsgdHVqdWFuLAovLyAgICBpc2lueWEgZGlwaW5kYWhrYW4ga2Ugc2FuYSAodGlkYWsgYWRhIG1vZHVsL3Bvc3QgeWFuZyBpa3V0IHRlcmhhcHVzKS4KLy8gIC0gVG9waWsgYmF3YWFuIChzcmMvbGliL2ZvbGRlclRyZWUuanMpIGRpY2F0YXQgZGkgdGFiZWwgcmVtb3ZlZF90b3BpY3Mgc3VwYXlhIGZvbGRlcm55YSBkaXNlbWJ1bnlpa2FuCi8vICAgIChhZG1pbl9zZXR1cF81LnNxbCkuIFRvcGlrIGJ1YXRhbiBwZW5nZ3VuYSBoaWxhbmcgc2VuZGlyaSBiZWdpdHUgaXNpbnlhIHBpbmRhaC4KaW1wb3J0IHsgTmV4dFJlc3BvbnNlIH0gZnJvbSAibmV4dC9zZXJ2ZXIiOwppbXBvcnQgeyBzdXBhYmFzZUFkbWluIH0gZnJvbSAiQC9saWIvc3VwYWJhc2VBZG1pbiI7CmltcG9ydCB7IHJlcXVpcmVBZG1pbiwgbG9nQWRtaW5BY3Rpb24gfSBmcm9tICJAL2xpYi9hZG1pbkF1dGgiOwppbXBvcnQgeyBGT0xERVJfVFJFRSB9IGZyb20gIkAvbGliL2ZvbGRlclRyZWUiOwoKZXhwb3J0IGNvbnN0IGR5bmFtaWMgPSAiZm9yY2UtZHluYW1pYyI7Cgpjb25zdCBORUVEU19TUUwgPSAiVGFiZWwgcGVuZ2hhcHVzYW4gdG9waWsgYmVsdW0gYWRhLiBKYWxhbmthbiBhZG1pbl9zZXR1cF81LnNxbCBkaSBTdXBhYmFzZSBTUUwgRWRpdG9yIGR1bHUuIjsKY29uc3Qgc3RyID0gKHYpID0+IFN0cmluZyh2ID8/ICIiKS50cmltKCk7CmNvbnN0IG5vcm0gPSAodikgPT4gc3RyKHYpLnRvTG93ZXJDYXNlKCk7CmNvbnN0IHRlbXBsYXRlTmFtZSA9IChzdWJqZWN0LCB0b3BpYykgPT4gKEZPTERFUl9UUkVFW3N1YmplY3RdIHx8IFtdKS5maW5kKCh0KSA9PiBub3JtKHQpID09PSBub3JtKHRvcGljKSkgfHwgbnVsbDsKY29uc3QgdGFibGVNaXNzaW5nID0gKGUpID0+ICEhZSAmJiAoZS5jb2RlID09PSAiNDJQMDEiIHx8IGUuY29kZSA9PT0gIlBHUlNUMjA1IiB8fCAvcmVtb3ZlZF90b3BpY3MvaS50ZXN0KGUubWVzc2FnZSB8fCAiIikpOwoKZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIFBPU1QocmVxdWVzdCkgewogIGNvbnN0IGEgPSBhd2FpdCByZXF1aXJlQWRtaW4ocmVxdWVzdCk7CiAgaWYgKGEuZXJyb3IpIHJldHVybiBhLmVycm9yOwogIHRyeSB7CiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVxdWVzdC5qc29uKCkuY2F0Y2goKCkgPT4gKHt9KSk7CiAgICBjb25zdCBzdWJqZWN0ID0gc3RyKGJvZHkuc3ViamVjdCk7CiAgICBjb25zdCB0b3BpYyA9IHN0cihib2R5LnRvcGljKTsKICAgIGlmICghc3ViamVjdCB8fCAhdG9waWMpIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IGVycm9yOiAic3ViamVjdCBkYW4gdG9waWMgd2FqaWIgZGlpc2kuIiB9LCB7IHN0YXR1czogNDAwIH0pOwogICAgY29uc3QgdHBsID0gdGVtcGxhdGVOYW1lKHN1YmplY3QsIHRvcGljKTsKCiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHB1bGloa2FuCiAgICBpZiAoYm9keS5yZXN0b3JlID09PSB0cnVlKSB7CiAgICAgIGlmICghdHBsKSByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogIkhhbnlhIHRvcGlrIGJhd2FhbiB5YW5nIGJpc2EgZGlwdWxpaGthbi4iIH0sIHsgc3RhdHVzOiA0MDAgfSk7CiAgICAgIGNvbnN0IGxvZ2dlZCA9IGF3YWl0IGxvZ0FkbWluQWN0aW9uKGEsIHsKICAgICAgICBhY3Rpb246ICJ0b3BpYy5yZXN0b3JlIiwKICAgICAgICB0YXJnZXRUeXBlOiAidG9waWMiLAogICAgICAgIHRhcmdldElkOiBgJHtzdWJqZWN0fS8ke3RwbH1gLAogICAgICAgIHRhcmdldExhYmVsOiBgJHtzdWJqZWN0fSAvICR7dHBsfWAsCiAgICAgICAgc25hcHNob3Q6IHsgc3ViamVjdCwgdG9waWM6IHRwbCB9LAogICAgICB9KTsKICAgICAgaWYgKCFsb2dnZWQpIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IGVycm9yOiAiQXVkaXQgbG9nIGdhZ2FsIOKAlCBha3NpIGRpYmF0YWxrYW4uIiB9LCB7IHN0YXR1czogNTAwIH0pOwogICAgICBjb25zdCB7IGVycm9yIH0gPSBhd2FpdCBzdXBhYmFzZUFkbWluLmZyb20oInJlbW92ZWRfdG9waWNzIikuZGVsZXRlKCkuZXEoInN1YmplY3QiLCBzdWJqZWN0KS5lcSgidG9waWMiLCB0cGwpOwogICAgICBpZiAoZXJyb3IpIHsKICAgICAgICBpZiAodGFibGVNaXNzaW5nKGVycm9yKSkgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgZXJyb3I6IE5FRURTX1NRTCB9LCB7IHN0YXR1czogNDA5IH0pOwogICAgICAgIGNvbnNvbGUuZXJyb3IoIkdhZ2FsIG1lbXVsaWhrYW4gdG9waWs6IiwgZXJyb3IpOwogICAgICAgIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IGVycm9yOiAiR2FnYWwgbWVtdWxpaGthbiB0b3Bpay4iIH0sIHsgc3RhdHVzOiA1MDAgfSk7CiAgICAgIH0KICAgICAgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgc3VjY2VzczogdHJ1ZSB9KTsKICAgIH0KCiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGhhcHVzCiAgICBjb25zdCBbbW9kcywgcG9zdHNdID0gYXdhaXQgUHJvbWlzZS5hbGwoWwogICAgICBzdXBhYmFzZUFkbWluLmZyb20oIm1vZHVsZXMiKS5zZWxlY3QoImlkIikuZXEoInN1YmplY3QiLCBzdWJqZWN0KS5lcSgidG9waWMiLCB0b3BpYykubGltaXQoNTAwMCksCiAgICAgIHN1cGFiYXNlQWRtaW4uZnJvbSgicG9zdHMiKS5zZWxlY3QoImlkIikuZXEoInN1YmplY3QiLCBzdWJqZWN0KS5lcSgidG9waWMiLCB0b3BpYykubGltaXQoNTAwMCksCiAgICBdKTsKICAgIGlmIChtb2RzLmVycm9yIHx8IHBvc3RzLmVycm9yKSB7CiAgICAgIGNvbnNvbGUuZXJyb3IoIkdhZ2FsIG1lbmdoaXR1bmcgaXNpIHRvcGlrOiIsIG1vZHMuZXJyb3IgfHwgcG9zdHMuZXJyb3IpOwogICAgICByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogIkdhZ2FsIG1lbWJhY2EgaXNpIHRvcGlrLiIgfSwgeyBzdGF0dXM6IDUwMCB9KTsKICAgIH0KICAgIGNvbnN0IG1vZHVsZUNvdW50ID0gKG1vZHMuZGF0YSB8fCBbXSkubGVuZ3RoOwogICAgY29uc3QgcG9zdENvdW50ID0gKHBvc3RzLmRhdGEgfHwgW10pLmxlbmd0aDsKICAgIGNvbnN0IGhhc0NvbnRlbnQgPSBtb2R1bGVDb3VudCArIHBvc3RDb3VudCA+IDA7CgogICAgaWYgKCF0cGwgJiYgIWhhc0NvbnRlbnQpIHsKICAgICAgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgZXJyb3I6ICJUb3BpayBpbmkgc3VkYWgga29zb25nIGRhbiB0aWRhayBtdW5jdWwgbGFnaSB1bnR1ayBzaXN3YS4iIH0sIHsgc3RhdHVzOiA0MDQgfSk7CiAgICB9CgogICAgbGV0IGRlc3QgPSBudWxsOwogICAgaWYgKGhhc0NvbnRlbnQpIHsKICAgICAgY29uc3QgdG9TdWJqZWN0ID0gc3RyKGJvZHkubW92ZVRvICYmIGJvZHkubW92ZVRvLnN1YmplY3QpOwogICAgICBjb25zdCB0b1RvcGljID0gc3RyKGJvZHkubW92ZVRvICYmIGJvZHkubW92ZVRvLnRvcGljKTsKICAgICAgaWYgKCF0b1N1YmplY3QgfHwgIXRvVG9waWMpIHsKICAgICAgICByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogYFRvcGlrIG1hc2loIGJlcmlzaSAke21vZHVsZUNvdW50fSBtb2R1bCBkYW4gJHtwb3N0Q291bnR9IHBvc3QuIFBpbGloIHRvcGlrIHR1anVhbiB1bnR1ayBtZW1pbmRhaGthbiBpc2lueWEuYCB9LCB7IHN0YXR1czogNDAwIH0pOwogICAgICB9CiAgICAgIGlmICh0b1N1YmplY3QgPT09IHN1YmplY3QgJiYgbm9ybSh0b1RvcGljKSA9PT0gbm9ybSh0b3BpYykpIHsKICAgICAgICByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogIlRvcGlrIHR1anVhbiB0aWRhayBib2xlaCBzYW1hIGRlbmdhbiB0b3BpayB5YW5nIGRpaGFwdXMuIiB9LCB7IHN0YXR1czogNDAwIH0pOwogICAgICB9CiAgICAgIGlmICh0b1RvcGljLmxlbmd0aCA+IDEyMCB8fCB0b1N1YmplY3QubGVuZ3RoID4gMTIwKSByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogIk5hbWEgbWFrc2ltYWwgMTIwIGthcmFrdGVyLiIgfSwgeyBzdGF0dXM6IDQwMCB9KTsKICAgICAgZGVzdCA9IHsgc3ViamVjdDogdG9TdWJqZWN0LCB0b3BpYzogdGVtcGxhdGVOYW1lKHRvU3ViamVjdCwgdG9Ub3BpYykgfHwgdG9Ub3BpYyB9OwogICAgfQoKICAgIC8vIENlayB0YWJlbCBEVUxVIChzZWJlbHVtIG1lbWluZGFoa2FuIGFwYSBwdW4pIHN1cGF5YSB0aWRhayBzZXRlbmdhaCBqYWxhbi4KICAgIGxldCByZW1vdmVkUm93cyA9IFtdOwogICAgewogICAgICBjb25zdCByID0gYXdhaXQgc3VwYWJhc2VBZG1pbi5mcm9tKCJyZW1vdmVkX3RvcGljcyIpLnNlbGVjdCgic3ViamVjdCwgdG9waWMiKTsKICAgICAgaWYgKHIuZXJyb3IpIHsKICAgICAgICBpZiAodHBsIHx8IGRlc3QpIHsKICAgICAgICAgIGlmICh0YWJsZU1pc3Npbmcoci5lcnJvcikpIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IGVycm9yOiBORUVEU19TUUwgfSwgeyBzdGF0dXM6IDQwOSB9KTsKICAgICAgICAgIGNvbnNvbGUuZXJyb3IoIkdhZ2FsIG1lbWJhY2EgcmVtb3ZlZF90b3BpY3M6Iiwgci5lcnJvcik7CiAgICAgICAgICByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogIkdhZ2FsIG1lbWJhY2EgZGFmdGFyIHRvcGlrIHRlcmhhcHVzLiIgfSwgeyBzdGF0dXM6IDUwMCB9KTsKICAgICAgICB9CiAgICAgIH0gZWxzZSByZW1vdmVkUm93cyA9IHIuZGF0YSB8fCBbXTsKICAgIH0KICAgIGlmIChkZXN0ICYmIHJlbW92ZWRSb3dzLnNvbWUoKHIpID0+IHIuc3ViamVjdCA9PT0gZGVzdC5zdWJqZWN0ICYmIG5vcm0oci50b3BpYykgPT09IG5vcm0oZGVzdC50b3BpYykpKSB7CiAgICAgIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IGVycm9yOiAiVG9waWsgdHVqdWFuIHN1ZGFoIGRpaGFwdXMuIFBpbGloIHRvcGlrIGxhaW4uIiB9LCB7IHN0YXR1czogNDAwIH0pOwogICAgfQoKICAgIGNvbnN0IGxvZ2dlZCA9IGF3YWl0IGxvZ0FkbWluQWN0aW9uKGEsIHsKICAgICAgYWN0aW9uOiAidG9waWMuZGVsZXRlIiwKICAgICAgdGFyZ2V0VHlwZTogInRvcGljIiwKICAgICAgdGFyZ2V0SWQ6IGAke3N1YmplY3R9LyR7dG9waWN9YCwKICAgICAgdGFyZ2V0TGFiZWw6IGRlc3QgPyBgJHtzdWJqZWN0fSAvICR7dG9waWN9IOKGkiAke2Rlc3Quc3ViamVjdH0gLyAke2Rlc3QudG9waWN9YCA6IGAke3N1YmplY3R9IC8gJHt0b3BpY31gLAogICAgICByZWFzb246IHN0cihib2R5LnJlYXNvbikgfHwgbnVsbCwKICAgICAgc25hcHNob3Q6IHsgc3ViamVjdCwgdG9waWMsIHRlbXBsYXRlOiAhIXRwbCwgbW9kdWxlczogbW9kdWxlQ291bnQsIHBvc3RzOiBwb3N0Q291bnQsIG1vdmVUbzogZGVzdCB9LAogICAgfSk7CiAgICBpZiAoIWxvZ2dlZCkgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgZXJyb3I6ICJBdWRpdCBsb2cgZ2FnYWwg4oCUIGFrc2kgZGliYXRhbGthbi4iIH0sIHsgc3RhdHVzOiA1MDAgfSk7CgogICAgbGV0IG1vdmVkTW9kdWxlcyA9IDA7CiAgICBsZXQgbW92ZWRQb3N0cyA9IDA7CiAgICBpZiAoaGFzQ29udGVudCkgewogICAgICBjb25zdCBtb2RQYXRjaCA9IHsgdG9waWM6IGRlc3QudG9waWMsIHN1YmplY3Q6IGRlc3Quc3ViamVjdCwgZW1iZWRkaW5nOiBudWxsIH07CiAgICAgIGlmICh0ZW1wbGF0ZU5hbWUoZGVzdC5zdWJqZWN0LCBkZXN0LnRvcGljKSkgbW9kUGF0Y2gudG9waWNfaXNfY3VzdG9tID0gZmFsc2U7CiAgICAgIGNvbnN0IHsgZGF0YTogbSwgZXJyb3I6IG1vZEVyciB9ID0gYXdhaXQgc3VwYWJhc2VBZG1pbi5mcm9tKCJtb2R1bGVzIikudXBkYXRlKG1vZFBhdGNoKS5lcSgic3ViamVjdCIsIHN1YmplY3QpLmVxKCJ0b3BpYyIsIHRvcGljKS5zZWxlY3QoImlkIik7CiAgICAgIGlmIChtb2RFcnIpIHsKICAgICAgICBjb25zb2xlLmVycm9yKCJHYWdhbCBtZW1pbmRhaGthbiBtb2R1bCBzYWF0IG1lbmdoYXB1cyB0b3BpazoiLCBtb2RFcnIpOwogICAgICAgIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IGVycm9yOiAiR2FnYWwgbWVtaW5kYWhrYW4gbW9kdWwuIFRvcGlrIGJlbHVtIGRpaGFwdXMuIiB9LCB7IHN0YXR1czogNTAwIH0pOwogICAgICB9CiAgICAgIG1vdmVkTW9kdWxlcyA9IChtIHx8IFtdKS5sZW5ndGg7CiAgICAgIGNvbnN0IHsgZGF0YTogcCwgZXJyb3I6IHBvc3RFcnIgfSA9IGF3YWl0IHN1cGFiYXNlQWRtaW4KICAgICAgICAuZnJvbSgicG9zdHMiKQogICAgICAgIC51cGRhdGUoeyB0b3BpYzogZGVzdC50b3BpYywgc3ViamVjdDogZGVzdC5zdWJqZWN0LCBlbWJlZGRpbmc6IG51bGwgfSkKICAgICAgICAuZXEoInN1YmplY3QiLCBzdWJqZWN0KQogICAgICAgIC5lcSgidG9waWMiLCB0b3BpYykKICAgICAgICAuc2VsZWN0KCJpZCIpOwogICAgICBpZiAocG9zdEVycikgY29uc29sZS5lcnJvcigiR2FnYWwgbWVtaW5kYWhrYW4gcG9zdCBzYWF0IG1lbmdoYXB1cyB0b3BpazoiLCBwb3N0RXJyKTsKICAgICAgbW92ZWRQb3N0cyA9IChwIHx8IFtdKS5sZW5ndGg7CiAgICB9CgogICAgaWYgKHRwbCkgewogICAgICBjb25zdCB7IGVycm9yIH0gPSBhd2FpdCBzdXBhYmFzZUFkbWluLmZyb20oInJlbW92ZWRfdG9waWNzIikudXBzZXJ0KHsgc3ViamVjdCwgdG9waWM6IHRwbCwgcmVtb3ZlZF9ieTogYS51c2VybmFtZSB8fCBudWxsIH0sIHsgb25Db25mbGljdDogInN1YmplY3QsdG9waWMiIH0pOwogICAgICBpZiAoZXJyb3IpIHsKICAgICAgICBjb25zb2xlLmVycm9yKCJHYWdhbCBtZW5jYXRhdCB0b3BpayB0ZXJoYXB1czoiLCBlcnJvcik7CiAgICAgICAgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgZXJyb3I6ICJJc2kgdG9waWsgc3VkYWggZGlwaW5kYWhrYW4sIHRldGFwaSBnYWdhbCBtZW55ZW1idW55aWthbiB0b3Bpay4gQ29iYSBoYXB1cyBsYWdpLiIgfSwgeyBzdGF0dXM6IDUwMCB9KTsKICAgICAgfQogICAgfQoKICAgIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IHN1Y2Nlc3M6IHRydWUsIG1vZHVsZXM6IG1vdmVkTW9kdWxlcywgcG9zdHM6IG1vdmVkUG9zdHMsIG5lZWRzRW1iZWQ6IG1vdmVkTW9kdWxlcyArIG1vdmVkUG9zdHMgPiAwLCBoaWRkZW46ICEhdHBsIH0pOwogIH0gY2F0Y2ggKGVycikgewogICAgY29uc29sZS5lcnJvcigiR2FnYWwgbWVtcHJvc2VzIHBlbmdoYXB1c2FuIHRvcGlrOiIsIGVycik7CiAgICByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogIkdhZ2FsIG1lbmdoYXB1cyB0b3Bpay4iIH0sIHsgc3RhdHVzOiA1MDAgfSk7CiAgfQp9Cg==",
  "delete_modal": "Ly8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBIYXB1cyB0b3BpawpmdW5jdGlvbiBEZWxldGVUb3BpY01vZGFsKHsgdG9waWMsIHRvcGljcywgb25DbG9zZSwgb25Eb25lIH0pIHsKICBjb25zdCBbZGVzdCwgc2V0RGVzdF0gPSB1c2VTdGF0ZSgiIik7CiAgY29uc3QgW3JlYXNvbiwgc2V0UmVhc29uXSA9IHVzZVN0YXRlKCIiKTsKICBjb25zdCBbYnVzeSwgc2V0QnVzeV0gPSB1c2VTdGF0ZShmYWxzZSk7CiAgY29uc3QgW2Vyciwgc2V0RXJyXSA9IHVzZVN0YXRlKCIiKTsKICBjb25zdCBoYXNDb250ZW50ID0gdG9waWMubW9kdWxlcyArIHRvcGljLnBvc3RzID4gMDsKICBjb25zdCBvcHRpb25zID0gdG9waWNzLmZpbHRlcigodCkgPT4gIXQucmVtb3ZlZCAmJiAhKHQuc3ViamVjdCA9PT0gdG9waWMuc3ViamVjdCAmJiB0LnRvcGljID09PSB0b3BpYy50b3BpYykpOwoKICBhc3luYyBmdW5jdGlvbiBnbygpIHsKICAgIHNldEJ1c3kodHJ1ZSk7CiAgICBzZXRFcnIoIiIpOwogICAgdHJ5IHsKICAgICAgY29uc3QgdGFyZ2V0ID0gZGVzdCAhPT0gIiIgPyBvcHRpb25zW051bWJlcihkZXN0KV0gOiBudWxsOwogICAgICBjb25zdCBib2R5ID0geyBzdWJqZWN0OiB0b3BpYy5zdWJqZWN0LCB0b3BpYzogdG9waWMudG9waWMsIG1vdmVUbzogdGFyZ2V0ID8geyBzdWJqZWN0OiB0YXJnZXQuc3ViamVjdCwgdG9waWM6IHRhcmdldC50b3BpYyB9IDogbnVsbCwgcmVhc29uIH07CiAgICAgIGNvbnN0IHIgPSBhd2FpdCBhcGkoInRvcGljcy9yZW1vdmUiLCB7IG1ldGhvZDogIlBPU1QiLCBib2R5IH0pOwogICAgICBvbkRvbmUocik7CiAgICAgIG9uQ2xvc2UoKTsKICAgIH0gY2F0Y2ggKGUpIHsKICAgICAgc2V0RXJyKGUubWVzc2FnZSk7CiAgICAgIHNldEJ1c3koZmFsc2UpOwogICAgfQogIH0KCiAgcmV0dXJuICgKICAgIDxNb2RhbCB0aXRsZT0iSGFwdXMgdG9waWsiIG9uQ2xvc2U9e29uQ2xvc2V9PgogICAgICA8cCBjbGFzc05hbWU9ImFkbS1tdXRlIj4KICAgICAgICBIYXB1cyA8Yj57dG9waWMuc3ViamVjdH0gLyB7dG9waWMudG9waWN9PC9iPj8KICAgICAgPC9wPgogICAgICA8cCBjbGFzc05hbWU9ImFkbS1tdXRlIj4KICAgICAgICB7dG9waWMudGVtcGxhdGUKICAgICAgICAgID8gIkluaSB0b3BpayBiYXdhYW4uIFNldGVsYWggZGloYXB1cywgZm9sZGVybnlhIGRpc2VtYnVueWlrYW4gZGFyaSBzaXN3YSBkYW4gZGFyaSBwaWxpaGFuIHRvcGlrIHNhYXQgdXBsb2FkLiBLYW11IGJpc2EgbWVtdWxpaGthbm55YSBsYWdpIGRhcmkgZGFmdGFyIGluaS4iCiAgICAgICAgICA6ICJJbmkgdG9waWsgYnVhdGFuIHBlbmdndW5hLiBUb3Bpa255YSBoaWxhbmcgZGFyaSBkYWZ0YXIgc2V0ZWxhaCBpc2lueWEgZGlwaW5kYWhrYW4uIn0KICAgICAgPC9wPgogICAgICB7aGFzQ29udGVudCA/ICgKICAgICAgICA8PgogICAgICAgICAgPGRpdiBjbGFzc05hbWU9ImFkbS1lcnIiIHN0eWxlPXt7IG1hcmdpblRvcDogMCB9fT4KICAgICAgICAgICAgVG9waWsgaW5pIG1hc2loIGJlcmlzaSB7dG9waWMubW9kdWxlc30gbW9kdWwgZGFuIHt0b3BpYy5wb3N0c30gcG9zdC4gVGlkYWsgYWRhIHlhbmcgaWt1dCB0ZXJoYXB1czogaXNpbnlhIGRpcGluZGFoa2FuIGtlIHRvcGlrIHR1anVhbi4KICAgICAgICAgIDwvZGl2PgogICAgICAgICAgPGxhYmVsIGNsYXNzTmFtZT0iYWRtLWxhYiI+UGluZGFoa2FuIGlzaW55YSBrZTwvbGFiZWw+CiAgICAgICAgICA8c2VsZWN0IGNsYXNzTmFtZT0iYWRtLXNlbCIgdmFsdWU9e2Rlc3R9IG9uQ2hhbmdlPXsoZSkgPT4gc2V0RGVzdChlLnRhcmdldC52YWx1ZSl9PgogICAgICAgICAgICA8b3B0aW9uIHZhbHVlPSIiPuKAlCBwaWxpaCB0b3BpayB0dWp1YW4g4oCUPC9vcHRpb24+CiAgICAgICAgICAgIHtvcHRpb25zLm1hcCgodCwgaSkgPT4gKAogICAgICAgICAgICAgIDxvcHRpb24ga2V5PXtgJHt0LnN1YmplY3R9fCR7dC50b3BpY31gfSB2YWx1ZT17U3RyaW5nKGkpfT4KICAgICAgICAgICAgICAgIHt0LnN1YmplY3R9IC8ge3QudG9waWN9CiAgICAgICAgICAgICAgPC9vcHRpb24+CiAgICAgICAgICAgICkpfQogICAgICAgICAgPC9zZWxlY3Q+CiAgICAgICAgPC8+CiAgICAgICkgOiAoCiAgICAgICAgPHAgY2xhc3NOYW1lPSJhZG0tbXV0ZSI+VG9waWsgaW5pIGtvc29uZywgamFkaSB0aWRhayBhZGEgeWFuZyBwZXJsdSBkaXBpbmRhaGthbi48L3A+CiAgICAgICl9CiAgICAgIDxsYWJlbCBjbGFzc05hbWU9ImFkbS1sYWIiPkNhdGF0YW4gKG9wc2lvbmFsKTwvbGFiZWw+CiAgICAgIDxpbnB1dCBjbGFzc05hbWU9ImFkbS1pbiIgdmFsdWU9e3JlYXNvbn0gb25DaGFuZ2U9eyhlKSA9PiBzZXRSZWFzb24oZS50YXJnZXQudmFsdWUpfSAvPgogICAgICB7ZXJyICYmIDxkaXYgY2xhc3NOYW1lPSJhZG0tZXJyIj57ZXJyfTwvZGl2Pn0KICAgICAgPGRpdiBjbGFzc05hbWU9ImFkbS1iYXIiIHN0eWxlPXt7IG1hcmdpblRvcDogMTIsIGp1c3RpZnlDb250ZW50OiAiZmxleC1lbmQiIH19PgogICAgICAgIDxidXR0b24gY2xhc3NOYW1lPSJhZG0tYnRuIiBvbkNsaWNrPXtvbkNsb3NlfSBkaXNhYmxlZD17YnVzeX0+CiAgICAgICAgICBCYXRhbAogICAgICAgIDwvYnV0dG9uPgogICAgICAgIDxidXR0b24gY2xhc3NOYW1lPSJhZG0tYnRuIGRuZyIgb25DbGljaz17Z299IGRpc2FibGVkPXtidXN5IHx8IChoYXNDb250ZW50ICYmIGRlc3QgPT09ICIiKX0+CiAgICAgICAgICB7YnVzeSA/ICJNZW1wcm9zZXPigKYiIDogIkhhcHVzIHRvcGlrIn0KICAgICAgICA8L2J1dHRvbj4KICAgICAgPC9kaXY+CiAgICA8L01vZGFsPgogICk7Cn0KCg==",
  "topic_handlers": "ICBhc3luYyBmdW5jdGlvbiBvbkRlbGV0ZWQocikgewogICAgbm90aWZ5KHIubW9kdWxlcyArIHIucG9zdHMgPiAwID8gYFRvcGlrIGRpaGFwdXMuICR7ci5tb2R1bGVzfSBtb2R1bCBkYW4gJHtyLnBvc3RzfSBwb3N0IGRpcGluZGFoa2FuLmAgOiAiVG9waWsgZGloYXB1cy4iKTsKICAgIHJlbG9hZCgpOwogICAgaWYgKHIubmVlZHNFbWJlZCkgewogICAgICB0cnkgewogICAgICAgIGF3YWl0IHJ1bkxvb3AoImVtYmVkIik7CiAgICAgICAgbm90aWZ5KCJJbmRla3MgcGVuY2FyaWFuIGRpcGVyYmFydWkuIik7CiAgICAgIH0gY2F0Y2ggKGUpIHsKICAgICAgICBub3RpZnkoYFRvcGlrIGRpaGFwdXMsIHRldGFwaSBpbmRla3MgcGVuY2FyaWFuIGJlbHVtIHNlbGVzYWk6ICR7ZS5tZXNzYWdlfS4gSmFsYW5rYW4gZGFyaSB0YWIgTWFpbnRlbmFuY2UuYCwgImVyciIpOwogICAgICB9CiAgICB9CiAgfQogIGFzeW5jIGZ1bmN0aW9uIHJlc3RvcmVUb3BpYyh0KSB7CiAgICB0cnkgewogICAgICBhd2FpdCBhcGkoInRvcGljcy9yZW1vdmUiLCB7IG1ldGhvZDogIlBPU1QiLCBib2R5OiB7IHN1YmplY3Q6IHQuc3ViamVjdCwgdG9waWM6IHQudG9waWMsIHJlc3RvcmU6IHRydWUgfSB9KTsKICAgICAgbm90aWZ5KGBUb3BpayAiJHt0LnRvcGljfSIgZGlwdWxpaGthbi5gKTsKICAgICAgcmVsb2FkKCk7CiAgICB9IGNhdGNoIChlKSB7CiAgICAgIG5vdGlmeShlLm1lc3NhZ2UsICJlcnIiKTsKICAgIH0KICB9Cgo=",
  "topics_sql_warning": "ICAgICAge2RhdGEubmVlZHNTcWwgJiYgKAogICAgICAgIDxkaXYgY2xhc3NOYW1lPSJhZG0tZXJyIiBzdHlsZT17eyBtYXJnaW5Ub3A6IDAsIG1hcmdpbkJvdHRvbTogMTAgfX0+CiAgICAgICAgICBUYWJlbCB0b3BpayB0ZXJoYXB1cyBiZWx1bSBhZGEsIGphZGkgaGFwdXMvcHVsaWhrYW4gdG9waWsgYmF3YWFuIGJlbHVtIGJpc2EgZGlwYWthaS4gSmFsYW5rYW4gYWRtaW5fc2V0dXBfNS5zcWwgZGkgU3VwYWJhc2UgU1FMIEVkaXRvci4KICAgICAgICA8L2Rpdj4KICAgICAgKX0K",
  "topics_modules_fix": "ZnVuY3Rpb24gbW9kdWxlVG9waWNzRm9yKHN1YmplY3QsIGV4dHJhLCByZW1vdmVkKSB7CiAgY29uc3QgZnVsbCA9IEZPTERFUl9UUkVFW3N1YmplY3RdIHx8IFtdOwogIGNvbnN0IG5vcm0gPSAodCkgPT4gU3RyaW5nKHQgfHwgIiIpLnRyaW0oKS50b0xvd2VyQ2FzZSgpOwogIC8vIFRvcGlrIGJhd2FhbiB5YW5nIHN1ZGFoIGRpaGFwdXMgYWRtaW4gZGlzZW1idW55aWthbiwga2VjdWFsaSBtYXNpaCBhZGEgbW9kdWwgZGkgZGFsYW1ueWEuCiAgY29uc3QgZ29uZSA9IG5ldyBTZXQoKHJlbW92ZWQgfHwgW10pLmZpbHRlcigocikgPT4gciAmJiByLnN1YmplY3QgPT09IHN1YmplY3QpLm1hcCgocikgPT4gbm9ybShyLnRvcGljKSkpOwogIGNvbnN0IHVzZWQgPSBuZXcgU2V0KChleHRyYSB8fCBbXSkuZmlsdGVyKChtKSA9PiBtLnN1YmplY3QgPT09IHN1YmplY3QpLm1hcCgobSkgPT4gbm9ybShtLnRvcGljKSkpOwogIGNvbnN0IGJhc2UgPSBmdWxsLmZpbHRlcigodCkgPT4gIWdvbmUuaGFzKG5vcm0odCkpIHx8IHVzZWQuaGFzKG5vcm0odCkpKTsKICBjb25zdCBzZWVuID0gbmV3IFNldChmdWxsLm1hcCgodCkgPT4gdC50b0xvd2VyQ2FzZSgpKSk7CiAgY29uc3QgY3VzdG9tID0gW107CiAgZm9yIChjb25zdCBtIG9mIGV4dHJhIHx8IFtdKSB7CiAgICBpZiAobS5zdWJqZWN0ICE9PSBzdWJqZWN0IHx8ICFtLnRvcGljKSBjb250aW51ZTsKICAgIGNvbnN0IGtleSA9IFN0cmluZyhtLnRvcGljKS50cmltKCkudG9Mb3dlckNhc2UoKTsKICAgIGlmICgha2V5IHx8IHNlZW4uaGFzKGtleSkpIGNvbnRpbnVlOwogICAgc2Vlbi5hZGQoa2V5KTsKICAgIGN1c3RvbS5wdXNoKFN0cmluZyhtLnRvcGljKS50cmltKCkpOwogIH0KICBjdXN0b20uc29ydCgoYSwgYikgPT4gYS5sb2NhbGVDb21wYXJlKGIpKTsKICByZXR1cm4gWy4uLmJhc2UubWFwKCh0KSA9PiAoeyBuYW1lOiB0LCBpc05ldzogZmFsc2UgfSkpLCAuLi5jdXN0b20ubWFwKCh0KSA9PiAoeyBuYW1lOiB0LCBpc05ldzogdHJ1ZSB9KSldOwp9Cg==",
  "profile_view": "Ly8gdzNzdHVkeS1wcm9maWxlLXYyOiB0YW1waWxhbiBwcm9maWwgeWFuZyBsZWJpaCBlbmFrIGRpYmFjYSAoYmlvLCBnb2FsLCBrZXRlcnRhcmlrYW4sIHNraWxsKQpmdW5jdGlvbiBQcm9maWxlVmlldyh7IGN0eCwgcHJvZmlsZSwgaXNPd25Qcm9maWxlLCBlZGl0aW5nUHJvZmlsZSwgc2V0TGlnaHRib3hBdmF0YXIgfSkgewogIGNvbnN0IHsgYywgc2Fucywgc3RhcnRFZGl0aW5nUHJvZmlsZSB9ID0gY3R4OwogIGNvbnN0IGludGVyZXN0cyA9IEFycmF5LmlzQXJyYXkocHJvZmlsZS5pbnRlcmVzdHMpID8gcHJvZmlsZS5pbnRlcmVzdHMgOiBbXTsKICBjb25zdCBza2lsbHMgPSBBcnJheS5pc0FycmF5KHByb2ZpbGUuc2tpbGxzKSA/IHByb2ZpbGUuc2tpbGxzIDogW107CiAgY29uc3QgY2FyZCA9IHsgcGFkZGluZzogIjIycHggMjRweCIsIGJvcmRlclJhZGl1czogMTgsIGJhY2tncm91bmQ6IGMuY2FyZCwgYm9yZGVyOiBgMXB4IHNvbGlkICR7Yy5saW5lfWAgfTsKCiAgY29uc3QgaGVhZGluZyA9IChpY29uLCBsYWJlbCwgYWNjZW50LCBzb2Z0LCBjb3VudCkgPT4gKAogICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiAiZmxleCIsIGFsaWduSXRlbXM6ICJjZW50ZXIiLCBnYXA6IDksIG1hcmdpbkJvdHRvbTogMTQgfX0+CiAgICAgIDxzcGFuIHN0eWxlPXt7IHdpZHRoOiAyOCwgaGVpZ2h0OiAyOCwgYm9yZGVyUmFkaXVzOiA5LCBiYWNrZ3JvdW5kOiBzb2Z0LCBkaXNwbGF5OiAiaW5saW5lLWZsZXgiLCBhbGlnbkl0ZW1zOiAiY2VudGVyIiwganVzdGlmeUNvbnRlbnQ6ICJjZW50ZXIiLCBmb250U2l6ZTogMTQsIGZsZXhTaHJpbms6IDAgfX0+e2ljb259PC9zcGFuPgogICAgICA8c3BhbiBzdHlsZT17eyBmb250RmFtaWx5OiBzYW5zLCBmb250V2VpZ2h0OiA3MDAsIGZvbnRTaXplOiAxMy41LCBjb2xvcjogYy5pbmsgfX0+e2xhYmVsfTwvc3Bhbj4KICAgICAge2NvdW50ID4gMCAmJiAoCiAgICAgICAgPHNwYW4gc3R5bGU9e3sgZm9udEZhbWlseTogc2FucywgZm9udFNpemU6IDExLCBmb250V2VpZ2h0OiA3MDAsIGNvbG9yOiBhY2NlbnQsIGJhY2tncm91bmQ6IHNvZnQsIHBhZGRpbmc6ICIxcHggOHB4IiwgYm9yZGVyUmFkaXVzOiA5OTkgfX0+e2NvdW50fTwvc3Bhbj4KICAgICAgKX0KICAgIDwvZGl2PgogICk7CiAgY29uc3QgY2hpcCA9ICh0ZXh0LCBhY2NlbnQsIHNvZnQpID0+ICgKICAgIDxzcGFuIGtleT17dGV4dH0gc3R5bGU9e3sgLi4ucHJvZmlsZUNoaXBTdHlsZShzYW5zLCBhY2NlbnQsIHNvZnQpLCBmb250U2l6ZTogMTIuNSwgcGFkZGluZzogIjZweCAxNHB4IiwgYm9yZGVyOiBgMXB4IHNvbGlkICR7YWNjZW50fTJFYCB9fT57dGV4dH08L3NwYW4+CiAgKTsKICBjb25zdCBlbXB0eUhpbnQgPSAod2hhdCkgPT4gKAogICAgPGRpdiBzdHlsZT17eyBmb250RmFtaWx5OiBzYW5zLCBmb250U2l6ZTogMTIuNSwgY29sb3I6IGMuaW5rRmFpbnQsIGxpbmVIZWlnaHQ6IDEuNiB9fT4KICAgICAge2lzT3duUHJvZmlsZSA/ICgKICAgICAgICA8PgogICAgICAgICAgQmVsdW0gYWRhIHt3aGF0fS57IiAifQogICAgICAgICAgPGJ1dHRvbgogICAgICAgICAgICBvbkNsaWNrPXtzdGFydEVkaXRpbmdQcm9maWxlfQogICAgICAgICAgICBzdHlsZT17eyBiYWNrZ3JvdW5kOiAibm9uZSIsIGJvcmRlcjogIm5vbmUiLCBwYWRkaW5nOiAwLCBjdXJzb3I6ICJwb2ludGVyIiwgZm9udEZhbWlseTogc2FucywgZm9udFNpemU6IDEyLjUsIGZvbnRXZWlnaHQ6IDcwMCwgY29sb3I6IGMuYmx1ZSB9fQogICAgICAgICAgPgogICAgICAgICAgICBUYW1iYWhrYW4KICAgICAgICAgIDwvYnV0dG9uPgogICAgICAgIDwvPgogICAgICApIDogKAogICAgICAgIGBCZWx1bSBhZGEgJHt3aGF0fS5gCiAgICAgICl9CiAgICA8L2Rpdj4KICApOwogIGNvbnN0IG5vdGhpbmdGaWxsZWQgPSAhcHJvZmlsZS5oZWFkbGluZSAmJiAhcHJvZmlsZS5nb2FsICYmICFpbnRlcmVzdHMubGVuZ3RoICYmICFza2lsbHMubGVuZ3RoOwoKICByZXR1cm4gKAogICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiAiZ3JpZCIsIGdyaWRUZW1wbGF0ZUNvbHVtbnM6ICIyODBweCAxZnIiLCBnYXA6IDI0LCBhbGlnbkl0ZW1zOiAic3RhcnQiIH19PgogICAgICA8SWRlbnRpdHlDYXJkIGN0eD17Y3R4fSBkcmFmdE1vZGU9e2ZhbHNlfSBwcm9maWxlPXtwcm9maWxlfSBpc093blByb2ZpbGU9e2lzT3duUHJvZmlsZX0gZWRpdGluZ1Byb2ZpbGU9e2VkaXRpbmdQcm9maWxlfSBzZXRMaWdodGJveEF2YXRhcj17c2V0TGlnaHRib3hBdmF0YXJ9IC8+CgogICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6ICJmbGV4IiwgZmxleERpcmVjdGlvbjogImNvbHVtbiIsIGdhcDogMTYsIG1pbldpZHRoOiAwIH19PgogICAgICAgIHtwcm9maWxlLmhlYWRsaW5lICYmICgKICAgICAgICAgIDxkaXYgc3R5bGU9e3sgLi4uY2FyZCwgcGFkZGluZzogIjI0cHggMjhweCIsIGJvcmRlckxlZnQ6IGA0cHggc29saWQgJHtjLmJsdWV9YCB9fT4KICAgICAgICAgICAge2hlYWRpbmcoIuKcje+4jyIsICJUZW50YW5nIiwgYy5ibHVlLCBjLmJsdWVTb2Z0KX0KICAgICAgICAgICAgPHAgc3R5bGU9e3sgZm9udEZhbWlseTogc2FucywgZm9udFNpemU6IDE0LjUsIGNvbG9yOiBjLmluaywgbGluZUhlaWdodDogMS43NSwgbWFyZ2luOiAwLCB3aGl0ZVNwYWNlOiAicHJlLXdyYXAiLCBvdmVyZmxvd1dyYXA6ICJhbnl3aGVyZSIgfX0+e3Byb2ZpbGUuaGVhZGxpbmV9PC9wPgogICAgICAgICAgPC9kaXY+CiAgICAgICAgKX0KCiAgICAgICAge3Byb2ZpbGUuZ29hbCAmJiAoCiAgICAgICAgICA8ZGl2IHN0eWxlPXt7IC4uLmNhcmQsIGJhY2tncm91bmQ6IGBsaW5lYXItZ3JhZGllbnQoMTM1ZGVnLCAke2MuYmx1ZVNvZnR9LCAke2MuY2FyZH0pYCwgYm9yZGVyOiBgMXB4IHNvbGlkICR7Yy5ibHVlfTIyYCB9fT4KICAgICAgICAgICAge2hlYWRpbmcoIvCfjq8iLCAiR29hbCIsIGMuYmx1ZSwgIiNGRkZGRkY5OSIpfQogICAgICAgICAgICA8cCBzdHlsZT17eyBmb250RmFtaWx5OiBzYW5zLCBmb250U2l6ZTogMTMuNSwgY29sb3I6IGMuaW5rLCBsaW5lSGVpZ2h0OiAxLjcsIG1hcmdpbjogMCwgd2hpdGVTcGFjZTogInByZS13cmFwIiwgb3ZlcmZsb3dXcmFwOiAiYW55d2hlcmUiIH19Pntwcm9maWxlLmdvYWx9PC9wPgogICAgICAgICAgPC9kaXY+CiAgICAgICAgKX0KCiAgICAgICAge25vdGhpbmdGaWxsZWQgPyAoCiAgICAgICAgICA8ZGl2IHN0eWxlPXt7IHBhZGRpbmc6ICIzMnB4IDI2cHgiLCBib3JkZXJSYWRpdXM6IDE2LCBiYWNrZ3JvdW5kOiBjLmNhcmQsIGJvcmRlcjogYDFweCBkYXNoZWQgJHtjLmxpbmV9YCwgdGV4dEFsaWduOiAiY2VudGVyIiB9fT4KICAgICAgICAgICAgPGRpdiBzdHlsZT17eyBmb250RmFtaWx5OiBzYW5zLCBmb250U2l6ZTogMTIuNSwgY29sb3I6IGMuaW5rRmFpbnQsIGZvbnRTdHlsZTogIml0YWxpYyIgfX0+CiAgICAgICAgICAgICAge2lzT3duUHJvZmlsZSA/ICJQcm9maWwgbWFzaWgga29zb25nIOKAlCBrbGlrIFwiRWRpdCBwcm9maWxcIiB1bnR1ayBtdWxhaSBtZW5naXNpLiIgOiAiUGVuZ2d1bmEgaW5pIGJlbHVtIG1lbmdpc2kgYmlvLiJ9CiAgICAgICAgICAgIDwvZGl2PgogICAgICAgICAgPC9kaXY+CiAgICAgICAgKSA6ICgKICAgICAgICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogImdyaWQiLCBncmlkVGVtcGxhdGVDb2x1bW5zOiAicmVwZWF0KGF1dG8tZml0LCBtaW5tYXgoMjQwcHgsIDFmcikpIiwgZ2FwOiAxNiB9fT4KICAgICAgICAgICAgPGRpdiBzdHlsZT17Y2FyZH0+CiAgICAgICAgICAgICAge2hlYWRpbmcoIvCfkqEiLCAiS2V0ZXJ0YXJpa2FuIiwgYy5haVRhZywgYy5haVRhZ1NvZnQsIGludGVyZXN0cy5sZW5ndGgpfQogICAgICAgICAgICAgIHtpbnRlcmVzdHMubGVuZ3RoID8gKAogICAgICAgICAgICAgICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiAiZmxleCIsIGZsZXhXcmFwOiAid3JhcCIsIGdhcDogOCB9fT57aW50ZXJlc3RzLm1hcCgoaSkgPT4gY2hpcChpLCBjLmFpVGFnLCBjLmFpVGFnU29mdCkpfTwvZGl2PgogICAgICAgICAgICAgICkgOiAoCiAgICAgICAgICAgICAgICBlbXB0eUhpbnQoImtldGVydGFyaWthbiIpCiAgICAgICAgICAgICAgKX0KICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgIDxkaXYgc3R5bGU9e2NhcmR9PgogICAgICAgICAgICAgIHtoZWFkaW5nKCLwn5ug77iPIiwgIlNraWxsIiwgYy5zdXBwb3J0QWNjZW50LCBjLnN1cHBvcnRTb2Z0LCBza2lsbHMubGVuZ3RoKX0KICAgICAgICAgICAgICB7c2tpbGxzLmxlbmd0aCA/ICgKICAgICAgICAgICAgICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogImZsZXgiLCBmbGV4V3JhcDogIndyYXAiLCBnYXA6IDggfX0+e3NraWxscy5tYXAoKHMpID0+IGNoaXAocywgYy5zdXBwb3J0QWNjZW50LCBjLnN1cHBvcnRTb2Z0KSl9PC9kaXY+CiAgICAgICAgICAgICAgKSA6ICgKICAgICAgICAgICAgICAgIGVtcHR5SGludCgic2tpbGwiKQogICAgICAgICAgICAgICl9CiAgICAgICAgICAgIDwvZGl2PgogICAgICAgICAgPC9kaXY+CiAgICAgICAgKX0KICAgICAgPC9kaXY+CiAgICA8L2Rpdj4KICApOwp9Cg==",
  "topics_get": "ICAgIC8vIFRvcGlrIGJhd2FhbiAoc3JjL2xpYi9mb2xkZXJUcmVlLmpzKSBpa3V0IGRpdGFtcGlsa2FuIHdhbGF1IGJlbHVtIHB1bnlhIGlzaSwgc3VwYXlhIGFkbWluIGJpc2EgbWVuZ2Vsb2xhbnlhLgogICAgY29uc3Qgbm9ybSA9ICh2KSA9PiBTdHJpbmcodiA/PyAiIikudHJpbSgpLnRvTG93ZXJDYXNlKCk7CiAgICBsZXQgbmVlZHNTcWwgPSBmYWxzZTsKICAgIGxldCByZW1vdmVkID0gW107CiAgICB7CiAgICAgIGNvbnN0IHIgPSBhd2FpdCBzdXBhYmFzZUFkbWluLmZyb20oInJlbW92ZWRfdG9waWNzIikuc2VsZWN0KCJzdWJqZWN0LCB0b3BpYyIpOwogICAgICBpZiAoci5lcnJvcikgbmVlZHNTcWwgPSB0cnVlOyAvLyB0YWJlbCBiZWx1bSBkaWJ1YXQgKGFkbWluX3NldHVwXzUuc3FsKQogICAgICBlbHNlIHJlbW92ZWQgPSByLmRhdGEgfHwgW107CiAgICB9CiAgICBjb25zdCByZW1vdmVkS2V5cyA9IG5ldyBTZXQocmVtb3ZlZC5tYXAoKHIpID0+IGAke3Iuc3ViamVjdH1cdTAwMDAke25vcm0oci50b3BpYyl9YCkpOwogICAgY29uc3QgYWxsID0gQXJyYXkuZnJvbShtYXAudmFsdWVzKCkpOwogICAgZm9yIChjb25zdCB0IG9mIGFsbCkgewogICAgICB0LnRlbXBsYXRlID0gKEZPTERFUl9UUkVFW3Quc3ViamVjdF0gfHwgW10pLnNvbWUoKG4pID0+IG5vcm0obikgPT09IG5vcm0odC50b3BpYykpOwogICAgICB0LnJlbW92ZWQgPSBmYWxzZTsKICAgIH0KICAgIGZvciAoY29uc3QgW3N1YmplY3QsIG5hbWVzXSBvZiBPYmplY3QuZW50cmllcyhGT0xERVJfVFJFRSkpIHsKICAgICAgZm9yIChjb25zdCBuYW1lIG9mIG5hbWVzKSB7CiAgICAgICAgY29uc3QgaXNSZW1vdmVkID0gcmVtb3ZlZEtleXMuaGFzKGAke3N1YmplY3R9XHUwMDAwJHtub3JtKG5hbWUpfWApOwogICAgICAgIGNvbnN0IGV4aXN0aW5nID0gYWxsLmZpbmQoKHQpID0+IHQuc3ViamVjdCA9PT0gc3ViamVjdCAmJiBub3JtKHQudG9waWMpID09PSBub3JtKG5hbWUpKTsKICAgICAgICBpZiAoZXhpc3RpbmcpIGV4aXN0aW5nLnJlbW92ZWQgPSBpc1JlbW92ZWQgJiYgZXhpc3RpbmcubW9kdWxlcyA9PT0gMCAmJiBleGlzdGluZy5wb3N0cyA9PT0gMDsgLy8gbWFzaWggYWRhIGlzaSA9IHRldGFwIHRhbXBpbCB1bnR1ayBzaXN3YQogICAgICAgIGVsc2UgYWxsLnB1c2goeyBzdWJqZWN0LCB0b3BpYzogbmFtZSwgbW9kdWxlczogMCwgcG9zdHM6IDAsIGN1c3RvbTogMCwgdGVtcGxhdGU6IHRydWUsIHJlbW92ZWQ6IGlzUmVtb3ZlZCB9KTsKICAgICAgfQogICAgfQogICAgY29uc3QgdG9waWNzID0gYWxsLnNvcnQoKHgsIHkpID0+IHguc3ViamVjdC5sb2NhbGVDb21wYXJlKHkuc3ViamVjdCkgfHwgeC50b3BpYy5sb2NhbGVDb21wYXJlKHkudG9waWMpKTsKICAgIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IHRvcGljcywgbmVlZHNTcWwgfSk7Cg==",
  "pdf_extract": "Ly8gcGRmLXBhcnNlIHYyIG1lbWFrYWkga2VsYXMgUERGUGFyc2UuIFdvcmtlciBoYXJ1cyBkaWltcG9yIFNFQkVMVU0gcGRmLXBhcnNlIChkaWJ1dHVoa2FuIGRpIE5leHQuanMgLyBWZXJjZWwpLgphd2FpdCBpbXBvcnQoInBkZi1wYXJzZS93b3JrZXIiKTsKY29uc3QgeyBQREZQYXJzZSB9ID0gYXdhaXQgaW1wb3J0KCJwZGYtcGFyc2UiKTsKY29uc3QgcGFyc2VyID0gbmV3IFBERlBhcnNlKHsgZGF0YTogbmV3IFVpbnQ4QXJyYXkoYnVmZmVyKSB9KTsKdHJ5IHsKICBjb25zdCBwYXJzZWQgPSBhd2FpdCBwYXJzZXIuZ2V0VGV4dCh7IHBhZ2VKb2luZXI6ICJcblxuIiB9KTsKICByZXR1cm4gKHBhcnNlZC50ZXh0IHx8ICIiKS5yZXBsYWNlKC9cbnszLH0vZywgIlxuXG4iKS5zbGljZSgwLCBNQVhfRklMRV9FWENFUlBUX0NIQVJTKTsKfSBmaW5hbGx5IHsKICBhd2FpdCBwYXJzZXIuZGVzdHJveSgpLmNhdGNoKCgpID0+IHt9KTsKfQo="
};
const S = (name) => Buffer.from(PAYLOAD[name], "base64").toString("utf8");

const ROOT = process.cwd();
const abs = (rel) => path.join(ROOT, ...rel.split("/"));
const exists = (rel) => fs.existsSync(abs(rel));
const results = [];
let backupDir = null;

function note(kind, msg) {
  results.push(kind);
  console.log("  [" + kind + "] " + msg);
}
function readText(rel) {
  let raw = fs.readFileSync(abs(rel), "utf8");
  const bom = raw.charCodeAt(0) === 0xfeff;
  if (bom) raw = raw.slice(1);
  return { text: raw.replace(/\r\n/g, "\n"), crlf: raw.includes("\r\n"), bom };
}
function writeText(rel, text, meta) {
  let out = text;
  if (meta.crlf) out = out.replace(/\n/g, "\r\n");
  if (meta.bom) out = "\uFEFF" + out;
  fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
  fs.writeFileSync(abs(rel), out, "utf8");
}
function backup(rel) {
  if (!exists(rel)) return;
  if (!backupDir) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    backupDir = "_update2-backup-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  const dest = path.join(ROOT, backupDir, ...rel.split("/"));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(abs(rel), dest);
}
// Hitung kurung/kurawal/siku (abaikan isi string & komentar) supaya hasil patch tidak merusak struktur file.
function balance(t) {
  let curly = 0, paren = 0, square = 0;
  let i = 0;
  const n = t.length;
  while (i < n) {
    const ch = t[i], nx = t[i + 1];
    if (ch === "/" && nx === "/") { while (i < n && t[i] !== "\n") i++; continue; }
    if (ch === "/" && nx === "*") { i += 2; while (i < n && !(t[i] === "*" && t[i + 1] === "/")) i++; i += 2; continue; }
    if (ch === '"' || ch === "'") {
      i++;
      while (i < n && t[i] !== ch && t[i] !== "\n") { if (t[i] === "\\") i++; i++; }
      i++;
      continue;
    }
    if (ch === "`") {
      i++;
      let depth = 0;
      while (i < n) {
        if (t[i] === "\\") { i += 2; continue; }
        if (depth === 0 && t[i] === "`") break;
        if (t[i] === "$" && t[i + 1] === "{") { depth++; i += 2; continue; }
        if (depth > 0 && t[i] === "}") { depth--; i++; continue; }
        i++;
      }
      i++;
      continue;
    }
    if (ch === "{") curly++; else if (ch === "}") curly--;
    else if (ch === "(") paren++; else if (ch === ")") paren--;
    else if (ch === "[") square++; else if (ch === "]") square--;
    i++;
  }
  return curly + "," + paren + "," + square;
}
// Ganti TEPAT satu kemunculan. pattern: string (harfiah) atau RegExp. repl: string (harfiah) atau fungsi.
function once(text, pattern, repl) {
  const fn = typeof repl === "function" ? repl : () => repl;
  if (typeof pattern === "string") {
    const first = text.indexOf(pattern);
    if (first < 0 || text.indexOf(pattern, first + pattern.length) >= 0) return null;
    return text.slice(0, first) + fn(pattern) + text.slice(first + pattern.length);
  }
  const hits = text.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"));
  if (!hits || hits.length !== 1) return null;
  return text.replace(pattern, fn);
}
function inFunction(t, marker, fn) {
  const s0 = t.indexOf(marker);
  if (s0 < 0) return null;
  const close = t.indexOf("\n}\n", s0);
  const e0 = close < 0 ? t.length : close + 3;
  const seg = t.slice(s0, e0);
  const out = fn(seg);
  if (out === null || out === seg) return null;
  return t.slice(0, s0) + out + t.slice(e0);
}
// Jalankan beberapa langkah berurutan; kalau satu saja gagal, seluruh edit dibatalkan (null).
function chain(text, steps) {
  let cur = text;
  for (const step of steps) {
    cur = step(cur);
    if (cur === null) return null;
  }
  return cur;
}
function runEdits(rel, edits) {
  if (!exists(rel)) {
    note("SKIP", rel + " tidak ditemukan");
    return;
  }
  const meta = readText(rel);
  let t = meta.text;
  let applied = 0;
  for (const e of edits) {
    if (e.done(t)) {
      note("SKIP", rel + " - " + e.name + " (sudah)");
      continue;
    }
    const out = e.apply(t);
    if (out === null || out === t) {
      note("GAGAL", rel + " - " + e.name + ": pola kode tidak cocok (file berbeda dari versi yang saya lihat)");
      continue;
    }
    t = out;
    applied++;
    note("OK", rel + " - " + e.name);
  }
  if (applied === 0) return;
  if (balance(t) !== balance(meta.text)) {
    note("GAGAL", rel + " - hasil tidak seimbang, TIDAK ditulis");
    return;
  }
  backup(rel);
  writeText(rel, t, meta);
}
function writeNew(rel, content) {
  if (exists(rel)) {
    const cur = readText(rel).text;
    if (cur === content.replace(/\r\n/g, "\n")) {
      note("SKIP", rel + " (sudah sama)");
      return;
    }
    backup(rel);
  }
  writeText(rel, content, { crlf: false, bom: false });
  note("OK", rel + " ditulis");
}


function indentBlock(text, ind) {
  return text.split("\n").map((l) => (l.length ? ind + l : l)).join("\n");
}
const FT_RE = /((?:\/\/[^\n]*\n)+)const FOLDER_TREE = (\{[\s\S]*?\n\});\n/;

// ================================================================ Homepage.jsx
function patchHomepage() {
  const rel = "src/app/components/Homepage.jsx";
  if (!exists(rel)) return note("GAGAL", rel + " tidak ditemukan");

  // FOLDER_TREE dipindah ke src/lib/folderTree.js (admin & server memakai daftar yang sama).
  // Berkas lib ditulis DULU, sebelum Homepage diubah, supaya tidak ada import ke berkas yang belum ada.
  const cur = readText(rel).text;
  const m = cur.match(FT_RE);
  if (m) {
    writeNew(
      "src/lib/folderTree.js",
      "// Topik bawaan per subject. Dipindahkan dari Homepage.jsx supaya Homepage, panel admin, dan server memakai daftar yang sama.\n" +
        m[1] +
        "export const FOLDER_TREE = " +
        m[2] +
        ";\n"
    );
  } else if (!cur.includes('from "@/lib/folderTree"')) {
    return note("GAGAL", rel + " - const FOLDER_TREE tidak ditemukan (file berbeda dari versi yang saya lihat)");
  }

  runEdits(rel, [
    {
      name: "FOLDER_TREE dipindah ke src/lib/folderTree.js",
      done: (t) => t.includes('from "@/lib/folderTree"'),
      apply: (t) =>
        chain(t, [
          (x) => once(x, FT_RE, "// FOLDER_TREE (subject -> topik bawaan) sekarang ada di src/lib/folderTree.js, dipakai juga oleh panel admin.\n"),
          (x) => once(x, 'import { supabase } from "@/lib/supabaseClient";\n', (s) => s + 'import { FOLDER_TREE } from "@/lib/folderTree";\n'),
        ]),
    },
    {
      name: "[2] FYI etika AI: di bawah kolom cari sebelum mencari, di bawah hasil sesudahnya",
      done: (t) => t.includes("{!hasQuery && <AiEthicsBanner ctx={ctx} embedded />}"),
      apply: (t) =>
        inFunction(t, "function SearchHub(", (seg) =>
          once(seg, /([ \t]*)\{\/\* results \*\/\}/, (mm, ind) => ind + "{!hasQuery && <AiEthicsBanner ctx={ctx} embedded />}\n\n" + mm)
        ),
    },
    {
      name: "[3] Aktivitas tersembunyi secara default",
      done: (t) => t.includes("// w3study: aktivitas tersembunyi secara default"),
      apply: (t) =>
        inFunction(t, "function MyActivityPanel(", (seg) =>
          chain(seg, [
            (x) => once(x, "const [hidden, setHidden] = useState(false);", "const [hidden, setHidden] = useState(true); // w3study: aktivitas tersembunyi secara default"),
            (x) => once(x, 'setHidden(window.localStorage.getItem(hiddenKey) === "1");', 'setHidden(window.localStorage.getItem(hiddenKey) !== "0"); // terbuka hanya kalau pernah dipilih "Tampilkan"'),
            (x) => once(x, "    } catch {\n      setHidden(false);\n    }", "    } catch {\n      setHidden(true);\n    }"),
          ])
        ),
    },
    {
      name: "[6] tampilan profil (bio, goal, ketertarikan, skill)",
      done: (t) => t.includes("w3study-profile-v2"),
      apply: (t) => inFunction(t, "function ProfileView(", () => S("profile_view")),
    },
    {
      name: "[7] semua topik muncul di dropdown upload (+ topik bawaan yang dihapus admin disembunyikan)",
      done: (t) => t.includes("removedTopics"),
      apply: (t) =>
        chain(t, [
          (x) => once(x, "  const [localModules, setLocalModules] = useState([]);\n", (s) => s + "  const [removedTopics, setRemovedTopics] = useState([]);\n"),
          (x) =>
            once(x, "        setLocalModules(result.modules.map(moduleFromApiRow));\n", (s) => s + "        setRemovedTopics(Array.isArray(result.removedTopics) ? result.removedTopics : []);\n"),
          (x) => inFunction(x, "function moduleTopicsFor(", () => S("topics_modules_fix")),
          (x) => once(x, "moduleTopicsFor(openSubject, localModules).map(", "moduleTopicsFor(openSubject, localModules, ctx.removedTopics).map("),
          (x) => once(x, "  setUploadingModule, resetModuleDraft, submitModuleUpload,\n}) {", "  setUploadingModule, resetModuleDraft, submitModuleUpload,\n  topicsForSubject,\n}) {"),
          (x) =>
            once(
              x,
              "  const topicOptions = FOLDER_TREE[moduleDraftSubject] || [];",
              '  // Semua topik subject ini: bawaan + topik buatan pengguna yang sudah ada (bukan hanya FOLDER_TREE).\n  const topicOptions = typeof topicsForSubject === "function" ? topicsForSubject(moduleDraftSubject) : FOLDER_TREE[moduleDraftSubject] || [];'
            ),
          (x) =>
            once(
              x,
              "setUploadingModule={setUploadingModule} resetModuleDraft={resetModuleDraft} submitModuleUpload={submitModuleUpload}\n",
              "setUploadingModule={setUploadingModule} resetModuleDraft={resetModuleDraft} submitModuleUpload={submitModuleUpload}\n      topicsForSubject={(s) => moduleTopicsFor(s, localModules, ctx.removedTopics).map((t) => t.name)}\n"
            ),
          (x) =>
            once(
              x,
              "highlightedModuleId, profileFor, profileSaveError, profilesByUsername, UsernameAvatar,",
              "highlightedModuleId, profileFor, profileSaveError, profilesByUsername, UsernameAvatar, removedTopics,"
            ),
        ]),
    },
  ]);
}

// ================================================================ /api/modules
function patchModulesRoute() {
  runEdits("src/app/api/modules/route.js", [
    {
      name: "GET /api/modules ikut mengirim removedTopics",
      done: (t) => t.includes("removedTopics"),
      apply: (t) =>
        once(
          t,
          "    return NextResponse.json({ modules: withUploaderNames });",
          [
            "    // Topik bawaan yang sudah dihapus admin (tabel removed_topics, admin_setup_5.sql).",
            "    // Tabel belum ada -> daftar kosong, daftar modul tetap jalan.",
            "    let removedTopics = [];",
            "    try {",
            '      const { data: removed, error: removedErr } = await supabaseAdmin.from("removed_topics").select("subject, topic");',
            "      if (!removedErr) removedTopics = removed || [];",
            "    } catch {}",
            "",
            "    return NextResponse.json({ modules: withUploaderNames, removedTopics });",
          ].join("\n")
        ),
    },
  ]);
}

// ================================================================ admin
function patchAdminTopicsRoute() {
  runEdits("src/app/api/admin/topics/route.js", [
    {
      name: "[4] GET menampilkan topik bawaan + status dihapus",
      done: (t) => t.includes('@/lib/folderTree'),
      apply: (t) =>
        chain(t, [
          (x) => once(x, 'import { requireAdmin, logAdminAction } from "@/lib/adminAuth";\n', (s) => s + 'import { FOLDER_TREE } from "@/lib/folderTree";\n'),
          (x) =>
            once(
              x,
              "    const topics = Array.from(map.values()).sort((x, y) => x.subject.localeCompare(y.subject) || x.topic.localeCompare(y.topic));\n    return NextResponse.json({ topics });",
              S("topics_get").replace(/\n$/, "")
            ),
        ]),
    },
  ]);
}

function patchAdminPage() {
  const rel = "src/app/admin/page.jsx";
  if (exists(rel) && !readText(rel).text.includes("function OrderModal(")) {
    return note("GAGAL", rel + " - belum ada fitur Urutkan modul. Jalankan w3study-update.bat (yang pertama) dulu.");
  }
  runEdits(rel, [
    {
      name: "[4] tab Topik: tampil semua topik, Hapus & Pulihkan",
      done: (t) => t.includes("function DeleteTopicModal("),
      apply: (t) =>
        chain(t, [
          (x) => once(x, "function TopicsTab({ notify }) {", (s) => S("delete_modal") + s),
          (x) => once(x, "  const [ordering, setOrdering] = useState(null);\n", (s) => s + "  const [deleting, setDeleting] = useState(null);\n"),
          (x) =>
            once(
              x,
              "  const topics = data.topics.filter((t) => `${t.subject} ${t.topic}`.toLowerCase().includes(filter.toLowerCase()));",
              (s) => S("topic_handlers") + s
            ),
          (x) => once(x, /[ \t]*<div className="adm-card">\n[ \t]*\{topics\.map\(\(t\) => \(/, (s) => S("topics_sql_warning") + s),
          (x) =>
            once(
              x,
              '{t.modules} modul · {t.posts} post {t.custom > 0 && <Badge tone="warn">{t.custom} buatan pengguna</Badge>}',
              (s) => s + ' {t.template && <Badge>bawaan</Badge>} {t.removed && <Badge tone="dng">dihapus</Badge>}'
            ),
          (x) => once(x, "{t.modules > 1 && (", "{!t.removed && t.modules > 1 && ("),
          (x) =>
            once(
              x,
              /([ \t]*)<button className="adm-btn" onClick=\{\(\) => setMoving\(t\)\}>\n[ \t]*Pindahkan \/ ganti nama\n[ \t]*<\/button>\n/,
              (s, ind) =>
                [
                  ind + "{t.removed ? (",
                  ind + '  <button className="adm-btn" onClick={() => restoreTopic(t)}>',
                  ind + "    Pulihkan",
                  ind + "  </button>",
                  ind + ") : (",
                  ind + "  <>",
                  ind + '    <button className="adm-btn" onClick={() => setMoving(t)}>',
                  ind + "      Pindahkan / ganti nama",
                  ind + "    </button>",
                  ind + '    <button className="adm-btn dng" onClick={() => setDeleting(t)}>',
                  ind + "      Hapus topik",
                  ind + "    </button>",
                  ind + "  </>",
                  ind + ")}",
                  "",
                ].join("\n")
            ),
          (x) =>
            once(
              x,
              /([ \t]*)\{ordering && <OrderModal [^\n]*\/>\}\n/,
              (s, ind) => s + ind + "{deleting && <DeleteTopicModal topic={deleting} topics={data.topics} onClose={() => setDeleting(null)} onDone={onDeleted} />}\n"
            ),
        ]),
    },
  ]);
}

// ================================================================ layout.js (hydration)
function patchLayout() {
  const rel = ["src/app/layout.js", "src/app/layout.jsx", "src/app/layout.tsx"].find(exists);
  if (!rel) return note("WARN", "src/app/layout.* tidak ditemukan; tambahkan suppressHydrationWarning pada <body> secara manual");
  runEdits(rel, [
    {
      name: "[1] <body suppressHydrationWarning> (atribut ekstensi browser)",
      done: (t) => /<body[^>]*suppressHydrationWarning/.test(t),
      apply: (t) => once(t, "<body>{children}</body>", "<body suppressHydrationWarning>{children}</body>") || once(t, /<body(\s+className=\{[^}]*\})>/, (s, cls) => "<body" + cls + " suppressHydrationWarning>"),
    },
  ]);
}

// ================================================================ pdf-parse
function pdfParseVersion() {
  try {
    return JSON.parse(fs.readFileSync(abs("node_modules/pdf-parse/package.json"), "utf8")).version;
  } catch {
    return null;
  }
}
function patchPdfParse() {
  runEdits("src/lib/moduleTagging.js", [
    {
      name: "[5] pdf-parse v2 (PDFParse), tanpa impor lib/pdf-parse.js",
      done: (t) => !t.includes("pdf-parse/lib/pdf-parse.js"),
      apply: (t) =>
        once(
          t,
          /(?:[ \t]*\/\/ Import langsung ke file lib:[^\n]*\n(?:[ \t]*\/\/ \('\.\/test[^\n]*\n)?)?([ \t]*)const pdfParse = \(await import\("pdf-parse\/lib\/pdf-parse\.js"\)\)\.default;\n[ \t]*const parsed = await pdfParse\(buffer\);\n[ \t]*return \(parsed\.text \|\| ""\)\.slice\(0, MAX_FILE_EXCERPT_CHARS\);\n/,
          (s, ind) => indentBlock(S("pdf_extract"), ind)
        ),
    },
  ]);
  const v = pdfParseVersion();
  if (v && parseInt(v, 10) >= 2) {
    note("SKIP", "pdf-parse " + v + " sudah versi 2 atau lebih baru");
  } else {
    console.log("   Memasang pdf-parse@latest (bisa beberapa menit)...");
    const r = spawnSync("npm", ["install", "pdf-parse@latest"], { cwd: ROOT, stdio: "inherit", shell: true });
    const v2 = pdfParseVersion();
    if (r.status === 0 && v2 && parseInt(v2, 10) >= 2) note("OK", "pdf-parse " + v2 + " terpasang");
    else note("GAGAL", "pdf-parse belum terpasang. Jalankan manual: npm install pdf-parse@latest");
  }
}
function patchNextConfig() {
  const rel = ["next.config.ts", "next.config.mjs", "next.config.js", "next.config.cjs"].find(exists);
  if (!rel) return note("WARN", 'next.config.* tidak ditemukan. Tambahkan: serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"]');
  const before = readText(rel).text;
  if (/serverExternalPackages/.test(before) && !/pdf-parse/.test(before)) {
    return note("WARN", rel + ' sudah punya serverExternalPackages. Tambahkan "pdf-parse" dan "@napi-rs/canvas" ke daftarnya secara manual.');
  }
  runEdits(rel, [
    {
      name: "[5] serverExternalPackages untuk pdf-parse (Next.js/Vercel)",
      done: (t) => /serverExternalPackages/.test(t) && /pdf-parse/.test(t),
      apply: (t) => once(t, /(const nextConfig(?:\s*:\s*[A-Za-z_.<>]+)?\s*=\s*\{)\n/, (s, head) => head + '\n  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],\n'),
    },
  ]);
}

// ================================================================ main
console.log("\nw3study update 2: topik, profil, hydration, pdf-parse\n");
if (!exists("package.json") || !exists("src/app")) {
  console.log("[GAGAL] Jalankan file ini dari folder proyek (yang berisi package.json dan src/app).");
  process.exit(1);
}

console.log("1) Berkas baru");
writeNew("admin-setup/admin_setup_5.sql", S("admin_setup_5_sql"));
if (exists("src/lib/adminAuth.js")) writeNew("src/app/api/admin/topics/remove/route.js", S("admin_topics_remove_route"));
else note("GAGAL", "src/lib/adminAuth.js tidak ada - jalankan installer admin dulu");

console.log("\n2) Homepage.jsx (FYI etika AI, aktivitas, profil, topik upload)");
patchHomepage();
console.log("\n3) /api/modules");
patchModulesRoute();
console.log("\n4) Panel admin (topik)");
patchAdminTopicsRoute();
patchAdminPage();
console.log("\n5) layout (error hydration)");
patchLayout();
console.log("\n6) pdf-parse");
patchPdfParse();
patchNextConfig();

const count = (k) => results.filter((r) => r === k).length;
console.log("\nRingkasan: " + count("OK") + " berhasil, " + count("SKIP") + " dilewati, " + count("WARN") + " peringatan, " + count("GAGAL") + " gagal.");
if (backupDir) console.log("Cadangan berkas asli: " + backupDir + "\\");
console.log("\nLangkah manual sesudahnya:");
console.log("  a) Supabase > SQL Editor: jalankan isi admin-setup/admin_setup_5.sql (sekali saja).");
console.log("  b) Hentikan lalu jalankan ulang npm run dev (next.config dan pdf-parse berubah).");
console.log("  c) Uji lokal, lalu commit dan push supaya Vercel deploy.");
if (count("GAGAL") > 0) console.log("\nAda langkah GAGAL di atas. Kirim barisnya ke saya; langkah yang gagal tidak mengubah apa pun, langkah lain tetap diterapkan.");
process.exit(count("GAGAL") > 0 ? 2 : 0);
