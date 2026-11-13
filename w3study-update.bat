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
set "W3_TMP=%TEMP%\w3study-update.cjs"
copy /y "%~f0" "%W3_TMP%" >nul
node "%W3_TMP%"
set "W3_CODE=%ERRORLEVEL%"
del "%W3_TMP%" >nul 2>nul
pause
exit /b %W3_CODE%
*/
const fs = require("fs");
const path = require("path");

const PAYLOAD = {
  "admin_setup_4_sql": "LS0gdzNzdHVkeSB1cGRhdGU6IHVydXRhbiBtb2R1bCBkaSBkYWxhbSB0b3BpayAoZGlhdHVyIGFkbWluKQotLSBKYWxhbmthbiBzZWthbGkgZGkgU3VwYWJhc2UgPiBTUUwgRWRpdG9yLgotLQotLSBzb3J0X29yZGVyID0gTlVMTCAgLT4gYmVsdW0gZGlhdHVyIChtb2R1bCB0YW1waWwgdGVyYmFydSBkdWx1LCBkaSBiYXdhaCBtb2R1bCB5YW5nIHN1ZGFoIGRpdXJ1dGthbikKLS0gc29ydF9vcmRlciA9IDEsMiwzIC0+IHVydXRhbiBkYXJpIGF0YXMga2UgYmF3YWggZGkgZGFsYW0gc2F0dSB0b3BpawoKYWx0ZXIgdGFibGUgcHVibGljLm1vZHVsZXMgYWRkIGNvbHVtbiBpZiBub3QgZXhpc3RzIHNvcnRfb3JkZXIgaW50ZWdlcjsKY3JlYXRlIGluZGV4IGlmIG5vdCBleGlzdHMgbW9kdWxlc190b3BpY19vcmRlcl9pZHggb24gcHVibGljLm1vZHVsZXMgKHN1YmplY3QsIHRvcGljLCBzb3J0X29yZGVyKTsKCm5vdGlmeSBwZ3JzdCwgJ3JlbG9hZCBzY2hlbWEnOwo=",
  "admin_topics_order_route": "Ly8gR0VUICAvYXBpL2FkbWluL3RvcGljcy9vcmRlcj9zdWJqZWN0PS4uJnRvcGljPS4uCi8vICAgICAgICAtPiBtb2R1bCBkYWxhbSBzYXR1IHRvcGlrLCBwZXJzaXMgc2VzdWFpIHVydXRhbiB5YW5nIGRpbGloYXQgc2lzd2EKLy8gUE9TVCAvYXBpL2FkbWluL3RvcGljcy9vcmRlciAgeyBzdWJqZWN0LCB0b3BpYywgaWRzOiBbLi4uXSB9Ci8vICAgICAgICAtPiBzaW1wYW4gdXJ1dGFuIGJhcnUgKGlkcyBkYXJpIGF0YXMga2UgYmF3YWg7IGhhcnVzIG1lbXVhdCBTRU1VQSBtb2R1bCB0b3BpayBpdHUpCi8vICAgICAgL2FwaS9hZG1pbi90b3BpY3Mvb3JkZXIgIHsgc3ViamVjdCwgdG9waWMsIHJlc2V0OiB0cnVlIH0KLy8gICAgICAgIC0+IGhhcHVzIHVydXRhbiBtYW51YWwgKGtlbWJhbGkga2UgInRlcmJhcnUgZHVsdSIpCi8vCi8vIFVydXRhbiBkaXNpbXBhbiBkaSBrb2xvbSBtb2R1bGVzLnNvcnRfb3JkZXIgKGxpaGF0IGFkbWluX3NldHVwXzQuc3FsKS4KLy8gTlVMTCA9IGJlbHVtIGRpYXR1cjsgbW9kdWwgdGFucGEgdXJ1dGFuIHRhbXBpbCBkaSBiYXdhaCB5YW5nIHN1ZGFoIGRpdXJ1dGthbi4KaW1wb3J0IHsgTmV4dFJlc3BvbnNlIH0gZnJvbSAibmV4dC9zZXJ2ZXIiOwppbXBvcnQgeyBzdXBhYmFzZUFkbWluIH0gZnJvbSAiQC9saWIvc3VwYWJhc2VBZG1pbiI7CmltcG9ydCB7IHJlcXVpcmVBZG1pbiwgbG9nQWRtaW5BY3Rpb24gfSBmcm9tICJAL2xpYi9hZG1pbkF1dGgiOwoKZXhwb3J0IGNvbnN0IGR5bmFtaWMgPSAiZm9yY2UtZHluYW1pYyI7Cgpjb25zdCBNQVhfTU9EVUxFUyA9IDUwMDsKY29uc3QgTkVFRFNfU1FMID0gIktvbG9tIHVydXRhbiBiZWx1bSBhZGEuIEphbGFua2FuIGFkbWluX3NldHVwXzQuc3FsIGRpIFN1cGFiYXNlIFNRTCBFZGl0b3IgZHVsdS4iOwpjb25zdCBzdHIgPSAodikgPT4gU3RyaW5nKHYgPz8gIiIpLnRyaW0oKTsKCmZ1bmN0aW9uIGJ5T3JkZXIoYSwgYikgewogIGNvbnN0IHggPSBhLnNvcnRfb3JkZXI7CiAgY29uc3QgeSA9IGIuc29ydF9vcmRlcjsKICBpZiAoeCA9PSBudWxsICYmIHkgPT0gbnVsbCkgcmV0dXJuIDA7CiAgaWYgKHggPT0gbnVsbCkgcmV0dXJuIDE7CiAgaWYgKHkgPT0gbnVsbCkgcmV0dXJuIC0xOwogIHJldHVybiB4IC0geTsKfQoKZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIEdFVChyZXF1ZXN0KSB7CiAgY29uc3QgYSA9IGF3YWl0IHJlcXVpcmVBZG1pbihyZXF1ZXN0KTsKICBpZiAoYS5lcnJvcikgcmV0dXJuIGEuZXJyb3I7CiAgdHJ5IHsKICAgIGNvbnN0IHsgc2VhcmNoUGFyYW1zIH0gPSBuZXcgVVJMKHJlcXVlc3QudXJsKTsKICAgIGNvbnN0IHN1YmplY3QgPSBzdHIoc2VhcmNoUGFyYW1zLmdldCgic3ViamVjdCIpKTsKICAgIGNvbnN0IHRvcGljID0gc3RyKHNlYXJjaFBhcmFtcy5nZXQoInRvcGljIikpOwogICAgaWYgKCFzdWJqZWN0IHx8ICF0b3BpYykgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgZXJyb3I6ICJzdWJqZWN0IGRhbiB0b3BpYyB3YWppYiBkaWlzaS4iIH0sIHsgc3RhdHVzOiA0MDAgfSk7CgogICAgbGV0IG5lZWRzU3FsID0gZmFsc2U7CiAgICBsZXQgeyBkYXRhLCBlcnJvciB9ID0gYXdhaXQgc3VwYWJhc2VBZG1pbgogICAgICAuZnJvbSgibW9kdWxlcyIpCiAgICAgIC5zZWxlY3QoImlkLCB0aXRsZSwgZmlsZV90eXBlLCBsaW5rX3VybCwgY3JlYXRlZF9hdCwgc29ydF9vcmRlciIpCiAgICAgIC5lcSgic3ViamVjdCIsIHN1YmplY3QpCiAgICAgIC5lcSgidG9waWMiLCB0b3BpYykKICAgICAgLm9yZGVyKCJjcmVhdGVkX2F0IiwgeyBhc2NlbmRpbmc6IGZhbHNlIH0pCiAgICAgIC5saW1pdChNQVhfTU9EVUxFUyk7CiAgICBpZiAoZXJyb3IgJiYgZXJyb3IuY29kZSA9PT0gIjQyNzAzIikgewogICAgICBuZWVkc1NxbCA9IHRydWU7CiAgICAgICh7IGRhdGEsIGVycm9yIH0gPSBhd2FpdCBzdXBhYmFzZUFkbWluCiAgICAgICAgLmZyb20oIm1vZHVsZXMiKQogICAgICAgIC5zZWxlY3QoImlkLCB0aXRsZSwgZmlsZV90eXBlLCBsaW5rX3VybCwgY3JlYXRlZF9hdCIpCiAgICAgICAgLmVxKCJzdWJqZWN0Iiwgc3ViamVjdCkKICAgICAgICAuZXEoInRvcGljIiwgdG9waWMpCiAgICAgICAgLm9yZGVyKCJjcmVhdGVkX2F0IiwgeyBhc2NlbmRpbmc6IGZhbHNlIH0pCiAgICAgICAgLmxpbWl0KE1BWF9NT0RVTEVTKSk7CiAgICB9CiAgICBpZiAoZXJyb3IpIHsKICAgICAgY29uc29sZS5lcnJvcigiR2FnYWwgbWVuZ2FtYmlsIG1vZHVsIHRvcGlrIChhZG1pbik6IiwgZXJyb3IpOwogICAgICByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogIkdhZ2FsIG1lbmdhbWJpbCBtb2R1bC4iIH0sIHsgc3RhdHVzOiA1MDAgfSk7CiAgICB9CiAgICAvLyBzb3J0KCkgc3RhYmlsOiB5YW5nIHNhbWEtc2FtYSBiZWx1bSBkaXVydXRrYW4gdGV0YXAgdGVyYmFydSBkdWx1LgogICAgY29uc3Qgcm93cyA9IFsuLi4oZGF0YSB8fCBbXSldLnNvcnQoYnlPcmRlcik7CiAgICByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oewogICAgICBuZWVkc1NxbCwKICAgICAgbW9kdWxlczogcm93cy5tYXAoKG0pID0+ICh7CiAgICAgICAgaWQ6IG0uaWQsCiAgICAgICAgdGl0bGU6IG0udGl0bGUgfHwgIih0YW5wYSBqdWR1bCkiLAogICAgICAgIHR5cGU6IG0ubGlua191cmwgPyAiTElOSyIgOiBtLmZpbGVfdHlwZSB8fCAiIiwKICAgICAgICBvcmRlcmVkOiBtLnNvcnRfb3JkZXIgIT0gbnVsbCwKICAgICAgfSkpLAogICAgfSk7CiAgfSBjYXRjaCAoZXJyKSB7CiAgICBjb25zb2xlLmVycm9yKCJHYWdhbCBtZW1wcm9zZXMgdXJ1dGFuIG1vZHVsIChhZG1pbik6IiwgZXJyKTsKICAgIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IGVycm9yOiAiR2FnYWwgbWVuZ2FtYmlsIG1vZHVsLiIgfSwgeyBzdGF0dXM6IDUwMCB9KTsKICB9Cn0KCmV4cG9ydCBhc3luYyBmdW5jdGlvbiBQT1NUKHJlcXVlc3QpIHsKICBjb25zdCBhID0gYXdhaXQgcmVxdWlyZUFkbWluKHJlcXVlc3QpOwogIGlmIChhLmVycm9yKSByZXR1cm4gYS5lcnJvcjsKICB0cnkgewogICAgY29uc3QgYm9keSA9IGF3YWl0IHJlcXVlc3QuanNvbigpLmNhdGNoKCgpID0+ICh7fSkpOwogICAgY29uc3Qgc3ViamVjdCA9IHN0cihib2R5LnN1YmplY3QpOwogICAgY29uc3QgdG9waWMgPSBzdHIoYm9keS50b3BpYyk7CiAgICBpZiAoIXN1YmplY3QgfHwgIXRvcGljKSByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogInN1YmplY3QgZGFuIHRvcGljIHdhamliIGRpaXNpLiIgfSwgeyBzdGF0dXM6IDQwMCB9KTsKCiAgICBjb25zdCB7IGRhdGE6IGdyb3VwLCBlcnJvcjogZ3JvdXBFcnIgfSA9IGF3YWl0IHN1cGFiYXNlQWRtaW4KICAgICAgLmZyb20oIm1vZHVsZXMiKQogICAgICAuc2VsZWN0KCJpZCIpCiAgICAgIC5lcSgic3ViamVjdCIsIHN1YmplY3QpCiAgICAgIC5lcSgidG9waWMiLCB0b3BpYykKICAgICAgLmxpbWl0KE1BWF9NT0RVTEVTKTsKICAgIGlmIChncm91cEVycikgewogICAgICBjb25zb2xlLmVycm9yKCJHYWdhbCBtZW1iYWNhIG1vZHVsIHRvcGlrOiIsIGdyb3VwRXJyKTsKICAgICAgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgZXJyb3I6ICJHYWdhbCBtZW1iYWNhIG1vZHVsIHRvcGlrLiIgfSwgeyBzdGF0dXM6IDUwMCB9KTsKICAgIH0KICAgIGNvbnN0IGdyb3VwSWRzID0gKGdyb3VwIHx8IFtdKS5tYXAoKHIpID0+IFN0cmluZyhyLmlkKSk7CgogICAgLy8gLS0tLSBrZW1iYWxpIGtlIHVydXRhbiBvdG9tYXRpcyAodGVyYmFydSBkdWx1KSAtLS0tCiAgICBpZiAoYm9keS5yZXNldCA9PT0gdHJ1ZSkgewogICAgICBjb25zdCBsb2dnZWQgPSBhd2FpdCBsb2dBZG1pbkFjdGlvbihhLCB7CiAgICAgICAgYWN0aW9uOiAidG9waWMucmVvcmRlcl9yZXNldCIsCiAgICAgICAgdGFyZ2V0VHlwZTogInRvcGljIiwKICAgICAgICB0YXJnZXRJZDogYCR7c3ViamVjdH0vJHt0b3BpY31gLAogICAgICAgIHRhcmdldExhYmVsOiBgJHtzdWJqZWN0fSAvICR7dG9waWN9YCwKICAgICAgICBzbmFwc2hvdDogeyBzdWJqZWN0LCB0b3BpYywgbW9kdWxlczogZ3JvdXBJZHMubGVuZ3RoIH0sCiAgICAgIH0pOwogICAgICBpZiAoIWxvZ2dlZCkgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgZXJyb3I6ICJBdWRpdCBsb2cgZ2FnYWwg4oCUIGFrc2kgZGliYXRhbGthbi4iIH0sIHsgc3RhdHVzOiA1MDAgfSk7CiAgICAgIGNvbnN0IHsgZXJyb3IgfSA9IGF3YWl0IHN1cGFiYXNlQWRtaW4uZnJvbSgibW9kdWxlcyIpLnVwZGF0ZSh7IHNvcnRfb3JkZXI6IG51bGwgfSkuZXEoInN1YmplY3QiLCBzdWJqZWN0KS5lcSgidG9waWMiLCB0b3BpYyk7CiAgICAgIGlmIChlcnJvcikgewogICAgICAgIGlmIChlcnJvci5jb2RlID09PSAiNDI3MDMiKSByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogTkVFRFNfU1FMIH0sIHsgc3RhdHVzOiA0MDkgfSk7CiAgICAgICAgY29uc29sZS5lcnJvcigiR2FnYWwgbWVyZXNldCB1cnV0YW4gbW9kdWw6IiwgZXJyb3IpOwogICAgICAgIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IGVycm9yOiAiR2FnYWwgbWVyZXNldCB1cnV0YW4uIiB9LCB7IHN0YXR1czogNTAwIH0pOwogICAgICB9CiAgICAgIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IHN1Y2Nlc3M6IHRydWUsIGNvdW50OiBncm91cElkcy5sZW5ndGggfSk7CiAgICB9CgogICAgLy8gLS0tLSBzaW1wYW4gdXJ1dGFuIGJhcnUgLS0tLQogICAgY29uc3QgaWRzID0gQXJyYXkuaXNBcnJheShib2R5LmlkcykgPyBib2R5Lmlkcy5tYXAoKHYpID0+IFN0cmluZyh2KSkgOiBudWxsOwogICAgaWYgKCFpZHMgfHwgaWRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgZXJyb3I6ICJpZHMgaGFydXMgYmVydXBhIGRhZnRhciBtb2R1bC4iIH0sIHsgc3RhdHVzOiA0MDAgfSk7CiAgICBpZiAoaWRzLmxlbmd0aCA+IE1BWF9NT0RVTEVTIHx8IG5ldyBTZXQoaWRzKS5zaXplICE9PSBpZHMubGVuZ3RoKSB7CiAgICAgIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IGVycm9yOiAiRGFmdGFyIG1vZHVsIHRpZGFrIHZhbGlkIChhZGEgZHVwbGlrYXQgYXRhdSB0ZXJsYWx1IGJhbnlhaykuIiB9LCB7IHN0YXR1czogNDAwIH0pOwogICAgfQogICAgY29uc3Qgc2FtZSA9IGlkcy5sZW5ndGggPT09IGdyb3VwSWRzLmxlbmd0aCAmJiBncm91cElkcy5ldmVyeSgoaWQpID0+IGlkcy5pbmNsdWRlcyhpZCkpOwogICAgaWYgKCFzYW1lKSB7CiAgICAgIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IGVycm9yOiAiSXNpIHRvcGlrIGJlcnViYWggc2VqYWsgZGFmdGFyIGRpbXVhdCAoYWRhIG1vZHVsIGJhcnUsIGRpaGFwdXMsIGF0YXUgZGlwaW5kYWgpLiBUdXR1cCBsYWx1IGJ1a2EgbGFnaS4iIH0sIHsgc3RhdHVzOiA0MDkgfSk7CiAgICB9CgogICAgY29uc3QgbG9nZ2VkID0gYXdhaXQgbG9nQWRtaW5BY3Rpb24oYSwgewogICAgICBhY3Rpb246ICJ0b3BpYy5yZW9yZGVyIiwKICAgICAgdGFyZ2V0VHlwZTogInRvcGljIiwKICAgICAgdGFyZ2V0SWQ6IGAke3N1YmplY3R9LyR7dG9waWN9YCwKICAgICAgdGFyZ2V0TGFiZWw6IGAke3N1YmplY3R9IC8gJHt0b3BpY31gLAogICAgICBzbmFwc2hvdDogeyBzdWJqZWN0LCB0b3BpYywgb3JkZXI6IGlkcyB9LAogICAgfSk7CiAgICBpZiAoIWxvZ2dlZCkgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgZXJyb3I6ICJBdWRpdCBsb2cgZ2FnYWwg4oCUIGFrc2kgZGliYXRhbGthbi4iIH0sIHsgc3RhdHVzOiA1MDAgfSk7CgogICAgLy8gU3VwYWJhc2UgdGlkYWsgcHVueWEgdXBkYXRlIG1hc3NhbCBkZW5nYW4gbmlsYWkgYmVyYmVkYSBwZXIgYmFyaXM7IHRvcGlrIGJlcmlzaSBwdWx1aGFuIG1vZHVsLCBqYWRpIHBlci1iYXJpcyBzYWphLgogICAgZm9yIChsZXQgaSA9IDA7IGkgPCBpZHMubGVuZ3RoOyBpICs9IDEwKSB7CiAgICAgIGNvbnN0IGNodW5rID0gaWRzLnNsaWNlKGksIGkgKyAxMCk7CiAgICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbCgKICAgICAgICBjaHVuay5tYXAoKGlkLCBrKSA9PiBzdXBhYmFzZUFkbWluLmZyb20oIm1vZHVsZXMiKS51cGRhdGUoeyBzb3J0X29yZGVyOiBpICsgayArIDEgfSkuZXEoImlkIiwgaWQpLmVxKCJzdWJqZWN0Iiwgc3ViamVjdCkuZXEoInRvcGljIiwgdG9waWMpKQogICAgICApOwogICAgICBjb25zdCBmYWlsZWQgPSByZXN1bHRzLmZpbmQoKHIpID0+IHIuZXJyb3IpOwogICAgICBpZiAoZmFpbGVkKSB7CiAgICAgICAgaWYgKGZhaWxlZC5lcnJvci5jb2RlID09PSAiNDI3MDMiKSByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogTkVFRFNfU1FMIH0sIHsgc3RhdHVzOiA0MDkgfSk7CiAgICAgICAgY29uc29sZS5lcnJvcigiR2FnYWwgbWVueWltcGFuIHVydXRhbiBtb2R1bDoiLCBmYWlsZWQuZXJyb3IpOwogICAgICAgIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IGVycm9yOiAiU2ViYWdpYW4gdXJ1dGFuIGdhZ2FsIGRpc2ltcGFuLiBDb2JhIGxhZ2kuIiB9LCB7IHN0YXR1czogNTAwIH0pOwogICAgICB9CiAgICB9CiAgICByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBzdWNjZXNzOiB0cnVlLCBjb3VudDogaWRzLmxlbmd0aCB9KTsKICB9IGNhdGNoIChlcnIpIHsKICAgIGNvbnNvbGUuZXJyb3IoIkdhZ2FsIG1lbXByb3NlcyB1cnV0YW4gbW9kdWw6IiwgZXJyKTsKICAgIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IGVycm9yOiAiR2FnYWwgbWVueWltcGFuIHVydXRhbi4iIH0sIHsgc3RhdHVzOiA1MDAgfSk7CiAgfQp9Cg==",
  "search_fix": "ICAgICAgICAvLyB3M3N0dWR5LWZpeDogYW1hbiB1bnR1ayBqdWR1bC90YWcga29zb25nIGF0YXUgdGFnIGJlcmJlbnR1ayBzdHJpbmcKICAgICAgICBjb25zdCBsYWJlbE9mID0gKHQpID0+IFN0cmluZyh0eXBlb2YgdCA9PT0gInN0cmluZyIgPyB0IDogKHQgJiYgdC5sYWJlbCkgfHwgIiIpOwogICAgICAgIGNvbnN0IGluVGl0bGUgPSBTdHJpbmcobS50aXRsZSB8fCAiIikudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhxKTsKICAgICAgICBjb25zdCBpblRhZ3MgPSAoQXJyYXkuaXNBcnJheShtLnRhZ3MpID8gbS50YWdzIDogW10pLnNvbWUoKHQpID0+IGxhYmVsT2YodCkudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhxKSk7Cg==",
  "sort": "ICAgIGlmIChzb3J0QnkgPT09ICJqdWR1bCIpIHsKICAgICAgcmVzdWx0ID0gWy4uLnJlc3VsdF0uc29ydCgoYSwgYikgPT4gU3RyaW5nKGEudGl0bGUgfHwgIiIpLmxvY2FsZUNvbXBhcmUoU3RyaW5nKGIudGl0bGUgfHwgIiIpKSk7CiAgICB9IGVsc2UgaWYgKHNvcnRCeSA9PT0gInVydXRhbiIgJiYgb3BlblRvcGljKSB7CiAgICAgIC8vIFVydXRhbiB5YW5nIGRpYXR1ciBhZG1pbiBkaSBkYWxhbSB0b3BpazsgbW9kdWwgdGFucGEgdXJ1dGFuIHRldGFwIGRpIGJhd2FoICh0ZXJiYXJ1IGR1bHUsIHNvcnQoKSBzdGFiaWwpLgogICAgICByZXN1bHQgPSBbLi4ucmVzdWx0XS5zb3J0KChhLCBiKSA9PiB7CiAgICAgICAgY29uc3QgeCA9IGEuc29ydE9yZGVyOwogICAgICAgIGNvbnN0IHkgPSBiLnNvcnRPcmRlcjsKICAgICAgICBpZiAoeCA9PSBudWxsICYmIHkgPT0gbnVsbCkgcmV0dXJuIDA7CiAgICAgICAgaWYgKHggPT0gbnVsbCkgcmV0dXJuIDE7CiAgICAgICAgaWYgKHkgPT0gbnVsbCkgcmV0dXJuIC0xOwogICAgICAgIHJldHVybiB4IC0geTsKICAgICAgfSk7CiAgICB9Cg==",
  "activity_hooks": "ICAvLyBTZW1idW55aWthbiAvIHRhbXBpbGthbiBwYW5lbCBha3Rpdml0YXMuIFBpbGloYW4gZGlzaW1wYW4gZGkgYnJvd3NlciwKICAvLyB0ZXJwaXNhaCB1bnR1ayBwcm9maWwgc2VuZGlyaSBkYW4gcHJvZmlsIG9yYW5nIGxhaW4uCiAgY29uc3QgaGlkZGVuS2V5ID0gZWRpdGFibGUgPyAidzNzdHVkeS5hY3Rpdml0eS5oaWRkZW4ub3duIiA6ICJ3M3N0dWR5LmFjdGl2aXR5LmhpZGRlbi5vdGhlcnMiOwogIGNvbnN0IFtoaWRkZW4sIHNldEhpZGRlbl0gPSB1c2VTdGF0ZShmYWxzZSk7CiAgdXNlRWZmZWN0KCgpID0+IHsKICAgIHRyeSB7CiAgICAgIHNldEhpZGRlbih3aW5kb3cubG9jYWxTdG9yYWdlLmdldEl0ZW0oaGlkZGVuS2V5KSA9PT0gIjEiKTsKICAgIH0gY2F0Y2ggewogICAgICBzZXRIaWRkZW4oZmFsc2UpOwogICAgfQogIH0sIFtoaWRkZW5LZXldKTsKICBmdW5jdGlvbiB0b2dnbGVBY3Rpdml0eUhpZGRlbigpIHsKICAgIGNvbnN0IG5leHQgPSAhaGlkZGVuOwogICAgc2V0SGlkZGVuKG5leHQpOwogICAgdHJ5IHsKICAgICAgd2luZG93LmxvY2FsU3RvcmFnZS5zZXRJdGVtKGhpZGRlbktleSwgbmV4dCA/ICIxIiA6ICIwIik7CiAgICB9IGNhdGNoIHt9CiAgfQo=",
  "activity_counts": "ICAgICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6ICJmbGV4IiwgYWxpZ25JdGVtczogImNlbnRlciIsIGdhcDogMTAgfX0+CiAgICAgICAgICA8c3BhbiBzdHlsZT17eyBmb250RmFtaWx5OiBzYW5zLCBmb250U2l6ZTogMTEsIGNvbG9yOiBjLmlua0ZhaW50IH19PgogICAgICAgICAgICB7bXlNb2R1bGVzLmxlbmd0aH0gbW9kdWwgwrcge215UG9zdHMubGVuZ3RofSBwb3N0IMK3IHtteVJlcGxpZXMubGVuZ3RofSBiYWxhc2FuCiAgICAgICAgICA8L3NwYW4+CiAgICAgICAgICA8YnV0dG9uCiAgICAgICAgICAgIG9uQ2xpY2s9e3RvZ2dsZUFjdGl2aXR5SGlkZGVufQogICAgICAgICAgICBhcmlhLWV4cGFuZGVkPXshaGlkZGVufQogICAgICAgICAgICBzdHlsZT17eyBiYWNrZ3JvdW5kOiAibm9uZSIsIGJvcmRlcjogYDFweCBzb2xpZCAke2MubGluZX1gLCBib3JkZXJSYWRpdXM6IDk5OSwgcGFkZGluZzogIjNweCAxMXB4IiwgZm9udEZhbWlseTogc2FucywgZm9udFNpemU6IDExLCBmb250V2VpZ2h0OiA3MDAsIGNvbG9yOiBjLmJsdWUsIGN1cnNvcjogInBvaW50ZXIiIH19CiAgICAgICAgICA+CiAgICAgICAgICAgIHtoaWRkZW4gPyAiVGFtcGlsa2FuIiA6ICJTZW1idW55aWthbiJ9CiAgICAgICAgICA8L2J1dHRvbj4KICAgICAgICA8L2Rpdj4K",
  "order_modal": "Ly8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBVcnV0YW4gbW9kdWwgZGFsYW0gdG9waWsKZnVuY3Rpb24gT3JkZXJNb2RhbCh7IHRvcGljLCBvbkNsb3NlLCBvblNhdmVkLCBub3RpZnkgfSkgewogIGNvbnN0IHBhdGggPSBgdG9waWNzL29yZGVyP3N1YmplY3Q9JHtlbmNvZGVVUklDb21wb25lbnQodG9waWMuc3ViamVjdCl9JnRvcGljPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHRvcGljLnRvcGljKX1gOwogIGNvbnN0IHsgZGF0YSwgbG9hZGluZywgZXJyb3IgfSA9IHVzZUxvYWQocGF0aCk7CiAgY29uc3QgW2xpc3QsIHNldExpc3RdID0gdXNlU3RhdGUoW10pOwogIGNvbnN0IFtkaXJ0eSwgc2V0RGlydHldID0gdXNlU3RhdGUoZmFsc2UpOwogIGNvbnN0IFtidXN5LCBzZXRCdXN5XSA9IHVzZVN0YXRlKGZhbHNlKTsKICBjb25zdCBbZXJyLCBzZXRFcnJdID0gdXNlU3RhdGUoIiIpOwoKICB1c2VFZmZlY3QoKCkgPT4gewogICAgaWYgKGRhdGEgJiYgQXJyYXkuaXNBcnJheShkYXRhLm1vZHVsZXMpKSB7CiAgICAgIHNldExpc3QoZGF0YS5tb2R1bGVzKTsKICAgICAgc2V0RGlydHkoZmFsc2UpOwogICAgfQogIH0sIFtkYXRhXSk7CgogIGZ1bmN0aW9uIG1vdmVUbyhmcm9tLCB0bykgewogICAgaWYgKGZyb20gPT09IHRvIHx8IHRvIDwgMCB8fCB0byA+PSBsaXN0Lmxlbmd0aCkgcmV0dXJuOwogICAgY29uc3QgbmV4dCA9IFsuLi5saXN0XTsKICAgIGNvbnN0IFtpdGVtXSA9IG5leHQuc3BsaWNlKGZyb20sIDEpOwogICAgbmV4dC5zcGxpY2UodG8sIDAsIGl0ZW0pOwogICAgc2V0TGlzdChuZXh0KTsKICAgIHNldERpcnR5KHRydWUpOwogIH0KCiAgYXN5bmMgZnVuY3Rpb24gc2F2ZShyZXNldCkgewogICAgc2V0QnVzeSh0cnVlKTsKICAgIHNldEVycigiIik7CiAgICB0cnkgewogICAgICBjb25zdCBib2R5ID0gcmVzZXQgPyB7IHN1YmplY3Q6IHRvcGljLnN1YmplY3QsIHRvcGljOiB0b3BpYy50b3BpYywgcmVzZXQ6IHRydWUgfSA6IHsgc3ViamVjdDogdG9waWMuc3ViamVjdCwgdG9waWM6IHRvcGljLnRvcGljLCBpZHM6IGxpc3QubWFwKChtKSA9PiBtLmlkKSB9OwogICAgICBjb25zdCByID0gYXdhaXQgYXBpKCJ0b3BpY3Mvb3JkZXIiLCB7IG1ldGhvZDogIlBPU1QiLCBib2R5IH0pOwogICAgICBub3RpZnkocmVzZXQgPyAiVXJ1dGFuIG1hbnVhbCBkaWhhcHVzIChrZW1iYWxpIHRlcmJhcnUgZHVsdSkuIiA6IGBVcnV0YW4gJHtyLmNvdW50fSBtb2R1bCBkaXNpbXBhbi5gKTsKICAgICAgb25TYXZlZCgpOwogICAgICBvbkNsb3NlKCk7CiAgICB9IGNhdGNoIChlKSB7CiAgICAgIHNldEVycihlLm1lc3NhZ2UpOwogICAgICBzZXRCdXN5KGZhbHNlKTsKICAgIH0KICB9CgogIHJldHVybiAoCiAgICA8TW9kYWwgdGl0bGU9e2BVcnV0a2FuIG1vZHVsIOKAlCAke3RvcGljLnRvcGljfWB9IG9uQ2xvc2U9e29uQ2xvc2V9IHdpZGU+CiAgICAgIDxwIGNsYXNzTmFtZT0iYWRtLW11dGUiPgogICAgICAgIFVydXRhbiBpbmkgeWFuZyBkaWxpaGF0IHNpc3dhIGRpIGRhbGFtIHRvcGlrIDxiPnt0b3BpYy5zdWJqZWN0fSAvIHt0b3BpYy50b3BpY308L2I+IChhdGFzID0gcGVydGFtYSkuIE1vZHVsIGJhcnUgeWFuZyBkaXVuZ2dhaCB0YW1waWwgZGkgYmF3YWggc2FtcGFpIGthbXUgdXJ1dGthbiBsYWdpLgogICAgICA8L3A+CiAgICAgIHtsb2FkaW5nICYmIDxwIGNsYXNzTmFtZT0iYWRtLW11dGUiPk1lbXVhdOKApjwvcD59CiAgICAgIHtlcnJvciAmJiA8cCBjbGFzc05hbWU9ImFkbS1lcnIiPntlcnJvcn08L3A+fQogICAgICB7ZGF0YSAmJiBkYXRhLm5lZWRzU3FsICYmIDxkaXYgY2xhc3NOYW1lPSJhZG0tZXJyIj5Lb2xvbSB1cnV0YW4gYmVsdW0gYWRhLiBKYWxhbmthbiBhZG1pbl9zZXR1cF80LnNxbCBkaSBTdXBhYmFzZSBTUUwgRWRpdG9yIGR1bHUuPC9kaXY+fQogICAgICB7IWxvYWRpbmcgJiYgIWVycm9yICYmICgKICAgICAgICA8ZGl2IHN0eWxlPXt7IG1heEhlaWdodDogIjU1dmgiLCBvdmVyZmxvd1k6ICJhdXRvIiB9fT4KICAgICAgICAgIHtsaXN0Lm1hcCgobSwgaSkgPT4gKAogICAgICAgICAgICA8ZGl2IGtleT17bS5pZH0gY2xhc3NOYW1lPSJhZG0tcm93IiBzdHlsZT17eyBhbGlnbkl0ZW1zOiAiY2VudGVyIiB9fT4KICAgICAgICAgICAgICA8c3BhbiBjbGFzc05hbWU9ImFkbS1tdXRlIiBzdHlsZT17eyB3aWR0aDogMjgsIHRleHRBbGlnbjogInJpZ2h0IiB9fT57aSArIDF9Ljwvc3Bhbj4KICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0ibWFpbiIgc3R5bGU9e3sgbWluV2lkdGg6IDAgfX0+CiAgICAgICAgICAgICAgICA8Yj57bS50aXRsZX08L2I+IHttLnR5cGUgJiYgPHNwYW4gY2xhc3NOYW1lPSJhZG0tYmFkZ2UiPnttLnR5cGV9PC9zcGFuPn0KICAgICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT0iYWRtLWJhciIgc3R5bGU9e3sgZ2FwOiA0LCBmbGV4U2hyaW5rOiAwIH19PgogICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzc05hbWU9ImFkbS1idG4iIGFyaWEtbGFiZWw9IktlIHBhbGluZyBhdGFzIiB0aXRsZT0iS2UgcGFsaW5nIGF0YXMiIGRpc2FibGVkPXtidXN5IHx8IGkgPT09IDB9IG9uQ2xpY2s9eygpID0+IG1vdmVUbyhpLCAwKX0+4qSSPC9idXR0b24+CiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzTmFtZT0iYWRtLWJ0biIgYXJpYS1sYWJlbD0iTmFpayBzYXR1IiB0aXRsZT0iTmFpayBzYXR1IiBkaXNhYmxlZD17YnVzeSB8fCBpID09PSAwfSBvbkNsaWNrPXsoKSA9PiBtb3ZlVG8oaSwgaSAtIDEpfT7ilrI8L2J1dHRvbj4KICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3NOYW1lPSJhZG0tYnRuIiBhcmlhLWxhYmVsPSJUdXJ1biBzYXR1IiB0aXRsZT0iVHVydW4gc2F0dSIgZGlzYWJsZWQ9e2J1c3kgfHwgaSA9PT0gbGlzdC5sZW5ndGggLSAxfSBvbkNsaWNrPXsoKSA9PiBtb3ZlVG8oaSwgaSArIDEpfT7ilrw8L2J1dHRvbj4KICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3NOYW1lPSJhZG0tYnRuIiBhcmlhLWxhYmVsPSJLZSBwYWxpbmcgYmF3YWgiIHRpdGxlPSJLZSBwYWxpbmcgYmF3YWgiIGRpc2FibGVkPXtidXN5IHx8IGkgPT09IGxpc3QubGVuZ3RoIC0gMX0gb25DbGljaz17KCkgPT4gbW92ZVRvKGksIGxpc3QubGVuZ3RoIC0gMSl9PuKkkzwvYnV0dG9uPgogICAgICAgICAgICAgIDwvZGl2PgogICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICkpfQogICAgICAgICAge2xpc3QubGVuZ3RoID09PSAwICYmIDxwIGNsYXNzTmFtZT0iYWRtLW11dGUiPlRpZGFrIGFkYSBtb2R1bCBkaSB0b3BpayBpbmkuPC9wPn0KICAgICAgICA8L2Rpdj4KICAgICAgKX0KICAgICAge2VyciAmJiA8ZGl2IGNsYXNzTmFtZT0iYWRtLWVyciI+e2Vycn08L2Rpdj59CiAgICAgIDxkaXYgY2xhc3NOYW1lPSJhZG0tYmFyIiBzdHlsZT17eyBtYXJnaW5Ub3A6IDEyLCBqdXN0aWZ5Q29udGVudDogInNwYWNlLWJldHdlZW4iIH19PgogICAgICAgIDxidXR0b24gY2xhc3NOYW1lPSJhZG0tYnRuIiBvbkNsaWNrPXsoKSA9PiBzYXZlKHRydWUpfSBkaXNhYmxlZD17YnVzeSB8fCBsb2FkaW5nIHx8ICEhZXJyb3IgfHwgbGlzdC5sZW5ndGggPT09IDB9PgogICAgICAgICAgSGFwdXMgdXJ1dGFuIG1hbnVhbAogICAgICAgIDwvYnV0dG9uPgogICAgICAgIDxkaXYgY2xhc3NOYW1lPSJhZG0tYmFyIj4KICAgICAgICAgIDxidXR0b24gY2xhc3NOYW1lPSJhZG0tYnRuIiBvbkNsaWNrPXtvbkNsb3NlfSBkaXNhYmxlZD17YnVzeX0+CiAgICAgICAgICAgIEJhdGFsCiAgICAgICAgICA8L2J1dHRvbj4KICAgICAgICAgIDxidXR0b24gY2xhc3NOYW1lPSJhZG0tYnRuIHByaSIgb25DbGljaz17KCkgPT4gc2F2ZShmYWxzZSl9IGRpc2FibGVkPXtidXN5IHx8ICFkaXJ0eSB8fCBsaXN0Lmxlbmd0aCA9PT0gMH0+CiAgICAgICAgICAgIHtidXN5ID8gIk1lbnlpbXBhbuKApiIgOiAiU2ltcGFuIHVydXRhbiJ9CiAgICAgICAgICA8L2J1dHRvbj4KICAgICAgICA8L2Rpdj4KICAgICAgPC9kaXY+CiAgICA8L01vZGFsPgogICk7Cn0KCg=="
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
    backupDir = "_update-backup-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
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

// ================================================================ Homepage.jsx
function patchHomepage() {
  const rel = "src/app/components/Homepage.jsx";
  runEdits(rel, [
    {
      id: "banner",
      name: "[1] FYI etika AI hanya di bawah hasil pencarian",
      // sudah selesai bila tidak ada lagi banner tepat sebelum blok hasil
      done: (t) => !/<AiEthicsBanner ctx=\{ctx\} embedded \/>\n\s*\n\s*\{\/\* results \*\/\}/.test(t),
      apply: (t) =>
        inFunction(t, "function SearchHub(", (seg) => {
          const count = (seg.match(/<AiEthicsBanner ctx=\{ctx\} embedded \/>/g) || []).length;
          if (count < 2) return null; // banner bawah tidak ada: jangan hapus yang atas, nanti hilang semua
          return once(seg, /[ \t]*<AiEthicsBanner ctx=\{ctx\} embedded \/>\n\n([ \t]*\{\/\* results \*\/\})/, (m, g1) => g1);
        }),
    },
    {
      id: "search",
      name: "[4] cari modul/tag tidak crash lagi (toLowerCase pada undefined)",
      done: (t) => t.includes("// w3study-fix: aman untuk judul/tag kosong"),
      apply: (t) =>
        once(
          t,
          /[ \t]*const inTitle = m\.title\.toLowerCase\(\)\.includes\(q\);\n[ \t]*const inTags = m\.tags\.some\(\(t\) => t\.label\.toLowerCase\(\)\.includes\(q\)\);\n/,
          S("search_fix")
        ),
    },
    {
      id: "sort",
      name: "[2] urutan buatan admin dipakai di dalam topik",
      done: (t) => t.includes('sortBy === "urutan"'),
      apply: (t) =>
        chain(t, [
          (x) => once(x, /[ \t]*if \(sortBy === "judul"\) result = \[\.\.\.result\]\.sort\(\(a, b\) => a\.title\.localeCompare\(b\.title\)\);\n/, S("sort")),
          (x) => once(x, 'const [sortBy, setSortBy] = useState("terbaru"); // terbaru | judul', 'const [sortBy, setSortBy] = useState("urutan"); // urutan | terbaru | judul'),
          (x) =>
            once(
              x,
              '<button style={chipStyle(sortBy === "terbaru")} onClick={() => setSortBy("terbaru")}>Terbaru</button>',
              '<button style={chipStyle(sortBy === "urutan")} onClick={() => setSortBy("urutan")}>Urutan topik</button>\n            <button style={chipStyle(sortBy === "terbaru")} onClick={() => setSortBy("terbaru")}>Terbaru</button>'
            ),
          (x) =>
            once(
              x,
              /([ \t]*)exerciseSetBy: row\.exercise_set_by \|\| "user",\n/,
              (m, ind) => m + ind + 'sortOrder: typeof row.sort_order === "number" ? row.sort_order : null,\n'
            ),
        ]),
    },
    {
      id: "activity",
      name: "[3] tombol sembunyikan/tampilkan Aktivitas (profil sendiri & orang lain)",
      done: (t) => t.includes("toggleActivityHidden"),
      apply: (t) =>
        inFunction(t, "function MyActivityPanel(", (seg) =>
          chain(seg, [
            (x) => once(x, '  const [tab, setTab] = useState("modul");\n', (m) => m + "\n" + S("activity_hooks")),
            (x) => once(x, 'justifyContent: "space-between", marginBottom: 4 }}>', 'justifyContent: "space-between", marginBottom: hidden ? 0 : 4 }}>'),
            (x) =>
              once(
                x,
                /[ \t]*<div style=\{\{ fontFamily: sans, fontSize: 11, color: c\.inkFaint \}\}>\n[ \t]*\{myModules\.length\} modul · \{myPosts\.length\} post · \{myReplies\.length\} balasan\n[ \t]*<\/div>\n/,
                S("activity_counts")
              ),
            (x) =>
              once(
                x,
                /\n([ \t]*<div style=\{\{ fontFamily: sans, fontSize: 11\.5, color: c\.inkMuted, marginBottom: 14 \}\}>\n[ \t]*\{editable\n)/,
                (m, g1) => "\n      {!hidden && (\n      <>\n" + g1
              ),
            (x) => once(x, /(\n[ \t]*<\/div>\n)([ \t]*<\/div>\n[ \t]*\);\n\}\n)$/, (m, g1, g2) => g1 + "      </>\n      )}\n" + g2),
          ])
        ),
    },
  ]);
}

// ================================================================ /api/modules
function patchModulesRoute() {
  const rel = "src/app/api/modules/route.js";
  const OLD = [
    '    let { data: modules, error } = await supabaseAdmin',
    '      .from("modules")',
    '      .select(`${baseCols}, is_exercise, exercise_set_by`)',
    '      .order("created_at", { ascending: false });',
    '    if (error && error.code === "42703") {',
    '      ({ data: modules, error } = await supabaseAdmin',
    '        .from("modules")',
    '        .select(baseCols)',
    '        .order("created_at", { ascending: false }));',
    '    }',
    "",
  ].join("\n");
  const NEW = [
    "    // Coba dari kolom terlengkap ke paling sedikit: kolom yang belum ada (SQL belum dijalankan)",
    "    // tidak boleh membuat daftar modul gagal. sort_order = urutan buatan admin (admin_setup_4.sql).",
    "    const attempts = [`${baseCols}, is_exercise, exercise_set_by, sort_order`, `${baseCols}, is_exercise, exercise_set_by`, baseCols];",
    "    let modules = null;",
    "    let error = null;",
    "    for (const cols of attempts) {",
    "      ({ data: modules, error } = await supabaseAdmin.from(\"modules\").select(cols).order(\"created_at\", { ascending: false }));",
    "      if (!error || error.code !== \"42703\") break;",
    "    }",
    "",
  ].join("\n");
  runEdits(rel, [
    {
      id: "modules-sort",
      name: "[2] GET /api/modules ikut mengirim sort_order",
      done: (t) => t.includes("sort_order"),
      apply: (t) => once(t, OLD, NEW),
    },
  ]);
}

// ================================================================ panel admin
function patchAdminPage() {
  const rel = "src/app/admin/page.jsx";
  runEdits(rel, [
    {
      id: "admin-order",
      name: "[2] tombol \"Urutkan modul\" di tab Topik",
      done: (t) => t.includes("function OrderModal("),
      apply: (t) =>
        chain(t, [
          (x) => once(x, "function TopicsTab({ notify }) {", (m) => S("order_modal") + m),
          (x) => once(x, '  const [moving, setMoving] = useState(null);\n', (m) => m + "  const [ordering, setOrdering] = useState(null);\n"),
          (x) =>
            once(
              x,
              /([ \t]*)<button className="adm-btn" onClick=\{\(\) => setMoving\(t\)\}>\n[ \t]*Pindahkan \/ ganti nama\n[ \t]*<\/button>\n/,
              (m, ind) =>
                ind + '<div className="adm-bar" style={{ gap: 6, flexShrink: 0 }}>\n' +
                ind + '  {t.modules > 1 && (\n' +
                ind + '    <button className="adm-btn" onClick={() => setOrdering(t)}>\n' +
                ind + '      Urutkan modul\n' +
                ind + '    </button>\n' +
                ind + '  )}\n' +
                ind + '  <button className="adm-btn" onClick={() => setMoving(t)}>\n' +
                ind + '    Pindahkan / ganti nama\n' +
                ind + '  </button>\n' +
                ind + '</div>\n'
            ),
          (x) =>
            once(
              x,
              /([ \t]*)\{moving && <MoveModal [^\n]*\/>\}\n/,
              (m, ind) => m + ind + "{ordering && <OrderModal topic={ordering} onClose={() => setOrdering(null)} onSaved={reload} notify={notify} />}\n"
            ),
        ]),
    },
  ]);
}

// ================================================================ main
console.log("\nw3study update: urutan modul, aktivitas profil, FYI etika AI, perbaikan pencarian\n");
if (!exists("package.json") || !exists("src/app")) {
  console.log("[GAGAL] Jalankan file ini dari folder proyek (yang berisi package.json dan src/app).");
  process.exit(1);
}

console.log("1) Berkas baru");
writeNew("admin-setup/admin_setup_4.sql", S("admin_setup_4_sql"));
if (exists("src/lib/adminAuth.js")) {
  writeNew("src/app/api/admin/topics/order/route.js", S("admin_topics_order_route"));
} else {
  note("GAGAL", "src/lib/adminAuth.js tidak ada - jalankan installer admin dulu");
}

console.log("\n2) Homepage.jsx (FYI etika AI, pencarian, urutan, aktivitas)");
if (exists("src/app/components/Homepage.jsx")) patchHomepage();
else note("GAGAL", "src/app/components/Homepage.jsx tidak ditemukan");

console.log("\n3) /api/modules");
patchModulesRoute();

console.log("\n4) Panel admin");
patchAdminPage();

const count = (k) => results.filter((r) => r === k).length;
console.log("\nRingkasan: " + count("OK") + " berhasil, " + count("SKIP") + " dilewati, " + count("GAGAL") + " gagal.");
if (backupDir) console.log("Cadangan berkas asli: " + backupDir + "\\");
console.log("\nLangkah manual sesudahnya:");
console.log("  a) Supabase > SQL Editor: jalankan isi admin-setup/admin_setup_4.sql (sekali saja).");
console.log("  b) Uji lokal (npm run dev), lalu commit dan push supaya Vercel deploy.");
if (count("GAGAL") > 0) console.log("\nAda langkah GAGAL di atas. Kirim barisnya ke saya; langkah yang gagal tidak mengubah apa pun; langkah lain tetap diterapkan.");
process.exit(count("GAGAL") > 0 ? 2 : 0);
