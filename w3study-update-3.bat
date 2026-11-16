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
set "W3_TMP=%TEMP%\w3study-update3.cjs"
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
  "admin_setup_6_sql": "LS0gdzNzdHVkeSB1cGRhdGUgMzogamVuaXMgcG9zdCAiaW5mb3JtYXNpIiArIHN0YXR1cyBiYWNhL2JlbHVtIGRpYmFjYSBmb3J1bQotLSBKYWxhbmthbiBzZWthbGkgZGkgU3VwYWJhc2UgPiBTUUwgRWRpdG9yLiBBbWFuIGRpamFsYW5rYW4gdWxhbmcuCgotLSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0KLS0gMSkgSXppbmthbiBwb3N0X3R5cGUgPSAnaW5mb3JtYXNpJwotLSAgICBLb2xvbSBwb3N0X3R5cGUgYmlzYSBiZXJ1cGEgdGV4dCArIENIRUNLLCBhdGF1IGVudW0uIFNrcmlwIGluaSBtZW5nZW5hbGkga2VkdWFueWEuCi0tICAgICdwZXJ0YW55YWFuJyB0ZXRhcCBkaWl6aW5rYW4gc3VwYXlhIHBvc3QgbGFtYSB0aWRhayBiZXJtYXNhbGFoIChVSSBzdWRhaCB0aWRhayBtZW5hd2Fya2FubnlhKS4KLS0gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tCmRvICQkCmRlY2xhcmUKICBjICAgcmVjb3JkOwogIGNvbCByZWNvcmQ7CmJlZ2luCiAgZm9yIGMgaW4KICAgIHNlbGVjdCBjb25uYW1lIGZyb20gcGdfY29uc3RyYWludAogICAgd2hlcmUgY29ucmVsaWQgPSAncHVibGljLnBvc3RzJzo6cmVnY2xhc3MgYW5kIGNvbnR5cGUgPSAnYycgYW5kIHBnX2dldF9jb25zdHJhaW50ZGVmKG9pZCkgaWxpa2UgJyVwb3N0X3R5cGUlJwogIGxvb3AKICAgIGV4ZWN1dGUgZm9ybWF0KCdhbHRlciB0YWJsZSBwdWJsaWMucG9zdHMgZHJvcCBjb25zdHJhaW50ICVJJywgYy5jb25uYW1lKTsKICBlbmQgbG9vcDsKCiAgc2VsZWN0IGRhdGFfdHlwZSwgdWR0X3NjaGVtYSwgdWR0X25hbWUgaW50byBjb2wKICBmcm9tIGluZm9ybWF0aW9uX3NjaGVtYS5jb2x1bW5zCiAgd2hlcmUgdGFibGVfc2NoZW1hID0gJ3B1YmxpYycgYW5kIHRhYmxlX25hbWUgPSAncG9zdHMnIGFuZCBjb2x1bW5fbmFtZSA9ICdwb3N0X3R5cGUnOwoKICBpZiBjb2wuZGF0YV90eXBlID0gJ1VTRVItREVGSU5FRCcgdGhlbgogICAgZXhlY3V0ZSBmb3JtYXQoJ2FsdGVyIHR5cGUgJUkuJUkgYWRkIHZhbHVlIGlmIG5vdCBleGlzdHMgJUwnLCBjb2wudWR0X3NjaGVtYSwgY29sLnVkdF9uYW1lLCAnaW5mb3JtYXNpJyk7CiAgZWxzZQogICAgLS0gTk9UIFZBTElEOiBoYW55YSBtZW1lcmlrc2EgcG9zdCBiYXJ1LCB0aWRhayBtZW5vbGFrIGJhcmlzIGxhbWEgYXBhIHB1biBpc2lueWEuCiAgICBleGVjdXRlICdhbHRlciB0YWJsZSBwdWJsaWMucG9zdHMgYWRkIGNvbnN0cmFpbnQgcG9zdHNfcG9zdF90eXBlX2NoZWNrIGNoZWNrIChwb3N0X3R5cGUgaW4gKCcnZGlza3VzaScnLCcnaWRlJycsJydzaGFyaW5nJycsJydwZXJ0YW55YWFuJycsJydpbmZvcm1hc2knJykpIG5vdCB2YWxpZCc7CiAgZW5kIGlmOwplbmQgJCQ7CgotLSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0KLS0gMikgU3RhdHVzIGJhY2EgZm9ydW0KLS0gICAgZm9ydW1fcmVhZF9zdGF0ZS5iYXNlbGluZSA6IHBvc3QgeWFuZyBkaWJ1YXQgU0VCRUxVTSB3YWt0dSBpbmkgZGlhbmdnYXAgc3VkYWggZGliYWNhCi0tICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAoc3VwYXlhIGZvcnVtIHlhbmcgc3VkYWggcmFtYWkgdGlkYWsgdGliYS10aWJhICJiZWx1bSBkaWJhY2EiIHNlbXVhKS4KLS0gICAgcG9zdF9yZWFkcyAgICAgICAgICAgICAgICA6IHBvc3QgeWFuZyBzdWRhaCBkaWJ1a2EgcGVuZ2d1bmEuCi0tIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQpjcmVhdGUgdGFibGUgaWYgbm90IGV4aXN0cyBwdWJsaWMuZm9ydW1fcmVhZF9zdGF0ZSAoCiAgdXNlcl9pZCAgdXVpZCBwcmltYXJ5IGtleSwKICBiYXNlbGluZSB0aW1lc3RhbXB0eiBub3QgbnVsbCBkZWZhdWx0IG5vdygpCik7CmNyZWF0ZSB0YWJsZSBpZiBub3QgZXhpc3RzIHB1YmxpYy5wb3N0X3JlYWRzICgKICB1c2VyX2lkIHV1aWQgbm90IG51bGwsCiAgcG9zdF9pZCB0ZXh0IG5vdCBudWxsLAogIHJlYWRfYXQgdGltZXN0YW1wdHogbm90IG51bGwgZGVmYXVsdCBub3coKSwKICBwcmltYXJ5IGtleSAodXNlcl9pZCwgcG9zdF9pZCkKKTsKY3JlYXRlIGluZGV4IGlmIG5vdCBleGlzdHMgcG9zdF9yZWFkc191c2VyX2lkeCBvbiBwdWJsaWMucG9zdF9yZWFkcyAodXNlcl9pZCk7CgphbHRlciB0YWJsZSBwdWJsaWMuZm9ydW1fcmVhZF9zdGF0ZSBlbmFibGUgcm93IGxldmVsIHNlY3VyaXR5OwphbHRlciB0YWJsZSBwdWJsaWMucG9zdF9yZWFkcyAgICAgICBlbmFibGUgcm93IGxldmVsIHNlY3VyaXR5OwpyZXZva2UgYWxsIG9uIHB1YmxpYy5mb3J1bV9yZWFkX3N0YXRlIGZyb20gYW5vbiwgYXV0aGVudGljYXRlZDsKcmV2b2tlIGFsbCBvbiBwdWJsaWMucG9zdF9yZWFkcyAgICAgICBmcm9tIGFub24sIGF1dGhlbnRpY2F0ZWQ7CmdyYW50IGFsbCBvbiBwdWJsaWMuZm9ydW1fcmVhZF9zdGF0ZSB0byBzZXJ2aWNlX3JvbGU7CmdyYW50IGFsbCBvbiBwdWJsaWMucG9zdF9yZWFkcyAgICAgICB0byBzZXJ2aWNlX3JvbGU7CgotLSBTZW11YSBwZW5nZ3VuYSB5YW5nIHN1ZGFoIGFkYTogcG9zdCBsYW1hIGRpYW5nZ2FwIHN1ZGFoIGRpYmFjYSwgeWFuZyBiYXJ1IHNldGVsYWggaW5pIGJlbHVtLgotLSAoUGVuZ2d1bmEgYmFydSBtZW5kYXBhdCBiYXJpcyBpbmkgb3RvbWF0aXMgc2FhdCBwZXJ0YW1hIG1lbWJ1a2EgZm9ydW0uKQppbnNlcnQgaW50byBwdWJsaWMuZm9ydW1fcmVhZF9zdGF0ZSAodXNlcl9pZCwgYmFzZWxpbmUpCnNlbGVjdCBpZDo6dXVpZCwgbm93KCkgZnJvbSBwdWJsaWMucHJvZmlsZXMKb24gY29uZmxpY3QgKHVzZXJfaWQpIGRvIG5vdGhpbmc7Cgpub3RpZnkgcGdyc3QsICdyZWxvYWQgc2NoZW1hJzsK",
  "forum_read_route": "Ly8gUE9TVCAvYXBpL2ZvcnVtL3JlYWQKLy8gICB7IHBvc3RJZHM6IFsuLl0gfSAgLT4gdGFuZGFpIHBvc3QtcG9zdCBpbmkgc3VkYWggZGliYWNhIG9sZWggcGVuZ2d1bmEgeWFuZyBsb2dpbgovLyAgIHsgYWxsOiB0cnVlIH0gICAgICAtPiB0YW5kYWkgU0VNVUEgcG9zdCB5YW5nIGFkYSBzZWthcmFuZyBzdWRhaCBkaWJhY2EKLy8KLy8gRGF0YSBhZGEgZGkgdGFiZWwgcG9zdF9yZWFkcyArIGZvcnVtX3JlYWRfc3RhdGUgKGFkbWluX3NldHVwXzYuc3FsKS4gS2FsYXUgdGFiZWxueWEgYmVsdW0KLy8gYWRhLCBlbmRwb2ludCBpbmkgZGlhbS1kaWFtIHN1a3NlcyAodHJhY2tpbmc6ZmFsc2UpIHN1cGF5YSBmb3J1bSB0aWRhayBwZXJuYWggZXJyb3Iga2FyZW5hIGZpdHVyIGluaS4KaW1wb3J0IHsgTmV4dFJlc3BvbnNlIH0gZnJvbSAibmV4dC9zZXJ2ZXIiOwppbXBvcnQgeyBzdXBhYmFzZUFkbWluIH0gZnJvbSAiQC9saWIvc3VwYWJhc2VBZG1pbiI7CmltcG9ydCB7IHJlcXVpcmVVc2VyIH0gZnJvbSAiQC9saWIvYWRtaW5BdXRoIjsKCmV4cG9ydCBjb25zdCBkeW5hbWljID0gImZvcmNlLWR5bmFtaWMiOwoKY29uc3QgTUFYX0lEUyA9IDUwOwpjb25zdCB0YWJsZU1pc3NpbmcgPSAoZSkgPT4gISFlICYmIChlLmNvZGUgPT09ICI0MlAwMSIgfHwgZS5jb2RlID09PSAiUEdSU1QyMDUiIHx8IC8ocG9zdF9yZWFkc3xmb3J1bV9yZWFkX3N0YXRlKS9pLnRlc3QoZS5tZXNzYWdlIHx8ICIiKSk7CgpleHBvcnQgYXN5bmMgZnVuY3Rpb24gUE9TVChyZXF1ZXN0KSB7CiAgY29uc3QgdSA9IGF3YWl0IHJlcXVpcmVVc2VyKHJlcXVlc3QpOwogIGlmICh1LmVycm9yKSByZXR1cm4gdS5lcnJvcjsKICBjb25zdCB1c2VySWQgPSB1LnVzZXIuaWQ7CiAgdHJ5IHsKICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZXF1ZXN0Lmpzb24oKS5jYXRjaCgoKSA9PiAoe30pKTsKCiAgICBpZiAoYm9keS5hbGwgPT09IHRydWUpIHsKICAgICAgLy8gQmFzZWxpbmUgPSBzZWthcmFuZzogc2VtdWEgcG9zdCB5YW5nIHN1ZGFoIGFkYSBkaWFuZ2dhcCBkaWJhY2EuIEJhcmlzIGxhbWEgdGlkYWsgZGlwZXJsdWthbiBsYWdpLgogICAgICBjb25zdCB7IGVycm9yIH0gPSBhd2FpdCBzdXBhYmFzZUFkbWluLmZyb20oImZvcnVtX3JlYWRfc3RhdGUiKS51cHNlcnQoeyB1c2VyX2lkOiB1c2VySWQsIGJhc2VsaW5lOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgfSwgeyBvbkNvbmZsaWN0OiAidXNlcl9pZCIgfSk7CiAgICAgIGlmIChlcnJvcikgewogICAgICAgIGlmICh0YWJsZU1pc3NpbmcoZXJyb3IpKSByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBzdWNjZXNzOiB0cnVlLCB0cmFja2luZzogZmFsc2UgfSk7CiAgICAgICAgY29uc29sZS5lcnJvcigiR2FnYWwgbWVuYW5kYWkgc2VtdWEgZGliYWNhOiIsIGVycm9yKTsKICAgICAgICByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogIkdhZ2FsIG1lbmFuZGFpIHNlbXVhIGRpYmFjYS4iIH0sIHsgc3RhdHVzOiA1MDAgfSk7CiAgICAgIH0KICAgICAgYXdhaXQgc3VwYWJhc2VBZG1pbi5mcm9tKCJwb3N0X3JlYWRzIikuZGVsZXRlKCkuZXEoInVzZXJfaWQiLCB1c2VySWQpOwogICAgICByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBzdWNjZXNzOiB0cnVlLCB0cmFja2luZzogdHJ1ZSB9KTsKICAgIH0KCiAgICBjb25zdCBpZHMgPSBBcnJheS5pc0FycmF5KGJvZHkucG9zdElkcykgPyBBcnJheS5mcm9tKG5ldyBTZXQoYm9keS5wb3N0SWRzLm1hcCgodikgPT4gU3RyaW5nKHYpKS5maWx0ZXIoQm9vbGVhbikpKS5zbGljZSgwLCBNQVhfSURTKSA6IFtdOwogICAgaWYgKGlkcy5sZW5ndGggPT09IDApIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IGVycm9yOiAicG9zdElkcyBoYXJ1cyBiZXJ1cGEgZGFmdGFyIGlkIHBvc3QuIiB9LCB7IHN0YXR1czogNDAwIH0pOwoKICAgIGNvbnN0IHsgZXJyb3IgfSA9IGF3YWl0IHN1cGFiYXNlQWRtaW4uZnJvbSgicG9zdF9yZWFkcyIpLnVwc2VydChpZHMubWFwKChpZCkgPT4gKHsgdXNlcl9pZDogdXNlcklkLCBwb3N0X2lkOiBpZCB9KSksIHsgb25Db25mbGljdDogInVzZXJfaWQscG9zdF9pZCIgfSk7CiAgICBpZiAoZXJyb3IpIHsKICAgICAgaWYgKHRhYmxlTWlzc2luZyhlcnJvcikpIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IHN1Y2Nlc3M6IHRydWUsIHRyYWNraW5nOiBmYWxzZSB9KTsKICAgICAgY29uc29sZS5lcnJvcigiR2FnYWwgbWVueWltcGFuIHN0YXR1cyBiYWNhOiIsIGVycm9yKTsKICAgICAgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgZXJyb3I6ICJHYWdhbCBtZW55aW1wYW4gc3RhdHVzIGJhY2EuIiB9LCB7IHN0YXR1czogNTAwIH0pOwogICAgfQogICAgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgc3VjY2VzczogdHJ1ZSwgdHJhY2tpbmc6IHRydWUgfSk7CiAgfSBjYXRjaCAoZXJyKSB7CiAgICBjb25zb2xlLmVycm9yKCJHYWdhbCBtZW1wcm9zZXMgc3RhdHVzIGJhY2E6IiwgZXJyKTsKICAgIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IGVycm9yOiAiR2FnYWwgbWVueWltcGFuIHN0YXR1cyBiYWNhLiIgfSwgeyBzdGF0dXM6IDUwMCB9KTsKICB9Cn0K",
  "feed_read_block": "ICAgIHBvc3RzID0gcG9zdHMgfHwgW107CgogICAgLy8gU3RhdHVzIGJhY2EgKHRhYmVsIGZvcnVtX3JlYWRfc3RhdGUgKyBwb3N0X3JlYWRzLCBhZG1pbl9zZXR1cF82LnNxbCkuCiAgICAvLyBUYWJlbCBiZWx1bSBhZGEgLT4gcmVhZFNldCA9IG51bGwgLT4gc2VtdWEgcG9zdCBkaWFuZ2dhcCBzdWRhaCBkaWJhY2EgKHRpZGFrIGFkYSB5YW5nIGRpdGFuZGFpICJiYXJ1IikuCiAgICBsZXQgcmVhZFNldCA9IG51bGw7CiAgICBsZXQgYmFzZWxpbmUgPSBudWxsOwogICAgdHJ5IHsKICAgICAgY29uc3Qgc3QgPSBhd2FpdCBzdXBhYmFzZUFkbWluLmZyb20oImZvcnVtX3JlYWRfc3RhdGUiKS5zZWxlY3QoImJhc2VsaW5lIikuZXEoInVzZXJfaWQiLCB1c2VySWQpLm1heWJlU2luZ2xlKCk7CiAgICAgIGlmICghc3QuZXJyb3IpIHsKICAgICAgICBpZiAoc3QuZGF0YSkgYmFzZWxpbmUgPSBzdC5kYXRhLmJhc2VsaW5lOwogICAgICAgIGVsc2UgewogICAgICAgICAgLy8gUGVuZ2d1bmEgYmFydTogcG9zdCB5YW5nIHN1ZGFoIGFkYSBzYWF0IHBlcnRhbWEgbWVtYnVrYSBmb3J1bSBkaWFuZ2dhcCBzdWRhaCBkaWJhY2EuCiAgICAgICAgICBjb25zdCBpbnMgPSBhd2FpdCBzdXBhYmFzZUFkbWluLmZyb20oImZvcnVtX3JlYWRfc3RhdGUiKS5pbnNlcnQoeyB1c2VyX2lkOiB1c2VySWQgfSkuc2VsZWN0KCJiYXNlbGluZSIpLnNpbmdsZSgpOwogICAgICAgICAgaWYgKCFpbnMuZXJyb3IpIGJhc2VsaW5lID0gaW5zLmRhdGEuYmFzZWxpbmU7CiAgICAgICAgfQogICAgICAgIGlmIChiYXNlbGluZSkgewogICAgICAgICAgY29uc3QgcnIgPSBhd2FpdCBzdXBhYmFzZUFkbWluLmZyb20oInBvc3RfcmVhZHMiKS5zZWxlY3QoInBvc3RfaWQiKS5lcSgidXNlcl9pZCIsIHVzZXJJZCkubGltaXQoMjAwMDApOwogICAgICAgICAgaWYgKCFyci5lcnJvcikgcmVhZFNldCA9IG5ldyBTZXQoKHJyLmRhdGEgfHwgW10pLm1hcCgocikgPT4gU3RyaW5nKHIucG9zdF9pZCkpKTsKICAgICAgICB9CiAgICAgIH0KICAgIH0gY2F0Y2ggKGVycikgewogICAgICBjb25zb2xlLmVycm9yKCJHYWdhbCBtZW1iYWNhIHN0YXR1cyBiYWNhIChmZWVkIHRldGFwIGRpa2lyaW0pOiIsIGVycik7CiAgICB9CiAgICBjb25zdCBiYXNlbGluZU1zID0gYmFzZWxpbmUgPyBuZXcgRGF0ZShiYXNlbGluZSkuZ2V0VGltZSgpIDogMDsKICAgIGNvbnN0IGlzUmVhZCA9IChwKSA9PiB7CiAgICAgIGlmICghcmVhZFNldCkgcmV0dXJuIHRydWU7IC8vIHBlbGFjYWthbiBiZWx1bSBha3RpZgogICAgICBpZiAocC5hdXRob3JfaWQgPT09IHVzZXJJZCkgcmV0dXJuIHRydWU7IC8vIHBvc3Qgc2VuZGlyaQogICAgICBpZiAobmV3IERhdGUocC5jcmVhdGVkX2F0KS5nZXRUaW1lKCkgPD0gYmFzZWxpbmVNcykgcmV0dXJuIHRydWU7IC8vIGRpYnVhdCBzZWJlbHVtIGZpdHVyIGluaSAvIHNlYmVsdW0gInRhbmRhaSBzZW11YSBkaWJhY2EiCiAgICAgIHJldHVybiByZWFkU2V0LmhhcyhTdHJpbmcocC5pZCkpOwogICAgfTsK",
  "gda_topics": "ICAvLyBTdW1iZXIgZGF5YSBzZWtvbGFoIEdEQSAoa2FsZW5kZXIsIHByZS1sYWIsIHBhbmR1YW4sIGZvcm11bGlyKS4gVG9waWsgYmlzYSBkaXRhbWJhaC9kaXViYWggYWRtaW4gZGkgdGFiIFRvcGlrLgogIEdEQTogWyJDYWxlbmRhciIsICJQcmUtTGFiIFBhcGVycyIsICJIYW5kYm9va3MgJiBQb2xpY2llcyIsICJGb3JtcyAmIFRlbXBsYXRlcyJdLAo=",
  "home_read_state": "ICBjb25zdCBbbG9jYWxQb3N0cywgc2V0TG9jYWxQb3N0c10gPSB1c2VTdGF0ZShbXSk7CgogIC8vIFN0YXR1cyBiYWNhIGZvcnVtLiBTZXJ2ZXIgbWVuYW5kYWkgcG9zdCB5YW5nIGJlbHVtIGRpYnVrYSBkZW5nYW4gcC5yZWFkID09PSBmYWxzZTsKICAvLyByZWFkSWRzIG1lbmNhdGF0IHBvc3QgeWFuZyBiYXJ1IGRpYnVrYSBkaSBzZXNpIGluaSAodGFucGEgbWVudW5nZ3UgZmVlZCBkaW11YXQgdWxhbmcpLgogIGNvbnN0IFtyZWFkSWRzLCBzZXRSZWFkSWRzXSA9IHVzZVN0YXRlKHt9KTsKICB1c2VFZmZlY3QoKCkgPT4gewogICAgaWYgKG9wZW5Qb3N0SWQgIT09IG51bGwgJiYgb3BlblBvc3RJZCAhPT0gdW5kZWZpbmVkKSBtYXJrUG9zdFJlYWQob3BlblBvc3RJZCk7CiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcmVhY3QtaG9va3MvZXhoYXVzdGl2ZS1kZXBzCiAgfSwgW29wZW5Qb3N0SWQsIGxvY2FsUG9zdHNdKTsK",
  "home_read_funcs": "ICBmdW5jdGlvbiBjbG9zZVRocmVhZCgpIHsKICAgIHNldE9wZW5Qb3N0SWQobnVsbCk7CiAgICBzZXRSZXBseVRhcmdldChudWxsKTsKICAgIHNldFJlcGx5RHJhZnQoIiIpOwogIH0KCiAgLy8gVGFuZGFpIHBvc3Qgc3VkYWggZGliYWNhIHNhYXQgdGhyZWFkL3J1YW5nIGNoYXQtbnlhIGRpYnVrYSAoZGFyaSBtYW5hIHB1biBkaWJ1a2FueWEpLgogIGFzeW5jIGZ1bmN0aW9uIG1hcmtQb3N0UmVhZChpZCkgewogICAgY29uc3QgcCA9IGxvY2FsUG9zdHMuZmluZCgoeCkgPT4geC5pZCA9PT0gaWQpOwogICAgaWYgKCFwIHx8IHAucmVhZCAhPT0gZmFsc2UgfHwgcmVhZElkc1tpZF0pIHJldHVybjsKICAgIHNldFJlYWRJZHMoKHByZXYpID0+ICh7IC4uLnByZXYsIFtpZF06IHRydWUgfSkpOwogICAgdHJ5IHsKICAgICAgY29uc3QgewogICAgICAgIGRhdGE6IHsgc2Vzc2lvbiB9LAogICAgICB9ID0gYXdhaXQgc3VwYWJhc2UuYXV0aC5nZXRTZXNzaW9uKCk7CiAgICAgIGlmICghc2Vzc2lvbikgcmV0dXJuOwogICAgICBhd2FpdCBmZXRjaCgiL2FwaS9mb3J1bS9yZWFkIiwgewogICAgICAgIG1ldGhvZDogIlBPU1QiLAogICAgICAgIGhlYWRlcnM6IHsgIkNvbnRlbnQtVHlwZSI6ICJhcHBsaWNhdGlvbi9qc29uIiwgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke3Nlc3Npb24uYWNjZXNzX3Rva2VufWAgfSwKICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IHBvc3RJZHM6IFtTdHJpbmcoaWQpXSB9KSwKICAgICAgfSk7CiAgICB9IGNhdGNoIHsKICAgICAgLy8gR2FnYWwgbWVueWltcGFuIGhhbnlhIGJlcmFydGkgcG9zdCB0YW1waWwgImJhcnUiIGxhZ2kgc2V0ZWxhaCBkaW11YXQgdWxhbmcuCiAgICB9CiAgfQogIGFzeW5jIGZ1bmN0aW9uIG1hcmtBbGxQb3N0c1JlYWQoKSB7CiAgICBjb25zdCBhbGwgPSB7fTsKICAgIGZvciAoY29uc3QgcCBvZiBsb2NhbFBvc3RzKSBpZiAocC5yZWFkID09PSBmYWxzZSkgYWxsW3AuaWRdID0gdHJ1ZTsKICAgIHNldFJlYWRJZHMoKHByZXYpID0+ICh7IC4uLnByZXYsIC4uLmFsbCB9KSk7CiAgICB0cnkgewogICAgICBjb25zdCB7CiAgICAgICAgZGF0YTogeyBzZXNzaW9uIH0sCiAgICAgIH0gPSBhd2FpdCBzdXBhYmFzZS5hdXRoLmdldFNlc3Npb24oKTsKICAgICAgaWYgKCFzZXNzaW9uKSByZXR1cm47CiAgICAgIGF3YWl0IGZldGNoKCIvYXBpL2ZvcnVtL3JlYWQiLCB7CiAgICAgICAgbWV0aG9kOiAiUE9TVCIsCiAgICAgICAgaGVhZGVyczogeyAiQ29udGVudC1UeXBlIjogImFwcGxpY2F0aW9uL2pzb24iLCBBdXRob3JpemF0aW9uOiBgQmVhcmVyICR7c2Vzc2lvbi5hY2Nlc3NfdG9rZW59YCB9LAogICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgYWxsOiB0cnVlIH0pLAogICAgICB9KTsKICAgIH0gY2F0Y2gge30KICB9Cg==",
  "postcard_consts": "ICBjb25zdCB7IGMsIHNhbnMsIENVUlJFTlRfVVNFUiwgb3BlblByb2ZpbGUsIGF2YXRhckZvciwgZGVsZXRlUG9zdCwgbG9jYWxSZXBsaWVzLCBjb3VudEFsbFJlcGxpZXMsIHNldEVkaXRpbmdQb3N0SWQgfSA9IGN0eDsKICAvLyBCZWx1bSBkaWJhY2E6IGRpc29yb3QuIEplbmlzICJJbmZvcm1hc2kiIHlhbmcgYmVsdW0gZGliYWNhIGRpc29yb3QgcGFsaW5nIGtvbnRyYXMgKG9yYW55ZSk7IHNldGVsYWggZGliYWNhIHRhbXBpbCBub3JtYWwuCiAgY29uc3QgdW5yZWFkID0gcC5yZWFkID09PSBmYWxzZSAmJiAhKGN0eC5yZWFkSWRzIHx8IHt9KVtwLmlkXTsKICBjb25zdCBpc0luZm8gPSBwLnBvc3RUeXBlID09PSAiaW5mb3JtYXNpIjsKICBjb25zdCBpbmZvQ29sb3IgPSBQT1NUX1RZUEVTLmluZm9ybWFzaS5jb2xvcjsKICBjb25zdCBmb3J1bUFjY2VudCA9IGN0eC5mb3J1bUFjY2VudDsK",
  "postcard_style": "ICAgICAgICBiYWNrZ3JvdW5kOiB1bnJlYWQgPyAoaXNJbmZvID8gIiNGRkVGRTIiIDogYCR7Zm9ydW1BY2NlbnR9MERgKSA6IGMuY2FyZCwKICAgICAgICBib3JkZXI6IHVucmVhZCAmJiBpc0luZm8gPyBgMXB4IHNvbGlkICR7aW5mb0NvbG9yfWAgOiBgMXB4IHNvbGlkICR7Yy5saW5lfWAsCiAgICAgICAgYm94U2hhZG93OiB1bnJlYWQgPyAoaXNJbmZvID8gYGluc2V0IDVweCAwIDAgJHtpbmZvQ29sb3J9LCAwIDZweCAxNnB4ICR7aW5mb0NvbG9yfTMwYCA6IGBpbnNldCAzcHggMCAwICR7Zm9ydW1BY2NlbnR9YCkgOiAibm9uZSIsCiAgICAgICAgY3Vyc29yOiAicG9pbnRlciIsCg==",
  "postcard_badge": "ICAgICAgICAgIDxQb3N0VHlwZUJhZGdlIGN0eD17Y3R4fSB0eXBlPXtwLnBvc3RUeXBlfSAvPgogICAgICAgICAge3VucmVhZCAmJiAoCiAgICAgICAgICAgIDxzcGFuCiAgICAgICAgICAgICAgc3R5bGU9e3sKICAgICAgICAgICAgICAgIGZvbnRGYW1pbHk6IHNhbnMsIGZvbnRTaXplOiAxMCwgZm9udFdlaWdodDogODAwLCBsZXR0ZXJTcGFjaW5nOiAwLjYsIGZsZXhTaHJpbms6IDAsIGJvcmRlclJhZGl1czogOTk5LAogICAgICAgICAgICAgICAgLi4uKGlzSW5mbwogICAgICAgICAgICAgICAgICA/IHsgY29sb3I6ICIjRkZGRkZGIiwgYmFja2dyb3VuZDogaW5mb0NvbG9yLCBwYWRkaW5nOiAiMi41cHggMTBweCIgfQogICAgICAgICAgICAgICAgICA6IHsgY29sb3I6IGZvcnVtQWNjZW50LCBiYWNrZ3JvdW5kOiBgJHtmb3J1bUFjY2VudH0xQWAsIHBhZGRpbmc6ICIyLjVweCA4cHgiIH0pLAogICAgICAgICAgICAgIH19CiAgICAgICAgICAgID4KICAgICAgICAgICAgICB7aXNJbmZvID8gIvCfk6IgQkFSVSIgOiAi4pePIEJBUlUifQogICAgICAgICAgICA8L3NwYW4+CiAgICAgICAgICApfQo=",
  "postlist_header": "ICAgICAgICA8c3BhbiBzdHlsZT17eyBkaXNwbGF5OiAiaW5saW5lLWZsZXgiLCBhbGlnbkl0ZW1zOiAiY2VudGVyIiwgZ2FwOiAxMCwgZmxleFdyYXA6ICJ3cmFwIiB9fT4KICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IGZvbnRGYW1pbHk6IHNhbnMsIGZvbnRTaXplOiAxMS41LCBjb2xvcjogYy5pbmtGYWludCwgZm9udFN0eWxlOiAiaXRhbGljIiB9fT57bG9jYWxQb3N0cy5sZW5ndGh9IHBvc3Q8L3NwYW4+CiAgICAgICAgICB7dW5yZWFkQ291bnQgPiAwICYmICgKICAgICAgICAgICAgPD4KICAgICAgICAgICAgICA8c3BhbiBzdHlsZT17eyBmb250RmFtaWx5OiBzYW5zLCBmb250U2l6ZTogMTEuNSwgZm9udFdlaWdodDogNzAwLCBjb2xvcjogZm9ydW1BY2NlbnQgfX0+4pePIHt1bnJlYWRDb3VudH0gYmVsdW0gZGliYWNhPC9zcGFuPgogICAgICAgICAgICAgIDxidXR0b24KICAgICAgICAgICAgICAgIG9uQ2xpY2s9e2N0eC5tYXJrQWxsUG9zdHNSZWFkfQogICAgICAgICAgICAgICAgc3R5bGU9e3sgYmFja2dyb3VuZDogIm5vbmUiLCBib3JkZXI6ICJub25lIiwgcGFkZGluZzogMCwgY3Vyc29yOiAicG9pbnRlciIsIGZvbnRGYW1pbHk6IHNhbnMsIGZvbnRTaXplOiAxMS41LCBmb250V2VpZ2h0OiA3MDAsIGNvbG9yOiBjLmJsdWUgfX0KICAgICAgICAgICAgICA+CiAgICAgICAgICAgICAgICBUYW5kYWkgc2VtdWEgZGliYWNhCiAgICAgICAgICAgICAgPC9idXR0b24+CiAgICAgICAgICAgIDwvPgogICAgICAgICAgKX0KICAgICAgICA8L3NwYW4+Cg=="
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
    backupDir = "_update3-backup-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
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


function replaceExactly(text, re, repl, n) {
  const g = new RegExp(re.source, "g");
  const hits = text.match(g);
  if (!hits || hits.length !== n) return null;
  return text.replace(g, repl);
}

// ================================================================ [1] GDA
function patchGda() {
  const rel = "src/lib/folderTree.js";
  if (!exists(rel)) return note("GAGAL", rel + " tidak ada - jalankan w3study-update-2.bat dulu");
  runEdits(rel, [
    {
      name: "[1] subject GDA (Calendar, Pre-Lab Papers, Handbooks & Policies, Forms & Templates)",
      done: (t) => /\n\s*GDA\s*:/.test(t),
      apply: (t) =>
        once(t, /(\n  CAS: \[[^\]]*\]),?\n\};\n$/, (m, cas) => cas + ",\n" + S("gda_topics") + "};\n"),
    },
  ]);
}

// ================================================================ Homepage.jsx
function patchHomepage() {
  const rel = "src/app/components/Homepage.jsx";
  if (!exists(rel)) return note("GAGAL", rel + " tidak ditemukan");
  if (!readText(rel).text.includes("removedTopics")) return note("GAGAL", rel + " - belum ada update 2. Jalankan w3study-update-2.bat dulu.");
  runEdits(rel, [
    {
      name: "[2] jenis post: hapus Pertanyaan, tambah Informasi (oranye)",
      done: (t) => t.includes("const postTypeMeta"),
      apply: (t) =>
        chain(t, [
          (x) =>
            once(
              x,
              /  pertanyaan: \{ label: "Pertanyaan", icon: "[^"]*", color: "#2C7BE5" \},\n\};\n/,
              '  informasi: { label: "Informasi", icon: "📢", color: "#F26B1D" },\n};\n\n' +
                "// Jenis lama yang tidak bisa dipilih lagi. Post lama dengan jenis ini tetap tampil dengan benar.\n" +
                'const LEGACY_POST_TYPES = { pertanyaan: { label: "Pertanyaan", icon: "❔", color: "#2C7BE5" } };\n' +
                "const postTypeMeta = (type) => POST_TYPES[type] || LEGACY_POST_TYPES[type] || POST_TYPES.diskusi;\n"
            ),
          (x) => once(x, "  const meta = POST_TYPES[type] || POST_TYPES.diskusi;", "  const meta = postTypeMeta(type);"),
          (x) => replaceExactly(x, /\(POST_TYPES\[p\.postType\] \|\| POST_TYPES\.diskusi\)\.(icon|label)/, (m, k) => "postTypeMeta(p.postType)." + k, 2),
          (x) =>
            once(
              x,
              'placeholder={draftPostType === "diskusi" ? "Topik ruang chat — apa yang mau didiskusikan bareng?" : "Apa yang lagi kamu pikirkan?"}',
              'placeholder={draftPostType === "diskusi" ? "Topik ruang chat — apa yang mau didiskusikan bareng?" : draftPostType === "informasi" ? "Tulis informasi untuk semua: jadwal, pengumuman, pengingat…" : "Apa yang lagi kamu pikirkan?"}'
            ),
        ]),
    },
    {
      name: "[3] status baca: state, penanda otomatis saat thread dibuka, data dari feed",
      done: (t) => t.includes("markPostRead"),
      apply: (t) =>
        chain(t, [
          (x) => once(x, "  const [localPosts, setLocalPosts] = useState([]);\n", S("home_read_state")),
          (x) => once(x, '  function closeThread() {\n    setOpenPostId(null);\n    setReplyTarget(null);\n    setReplyDraft("");\n  }\n', S("home_read_funcs")),
          (x) => once(x, "          chat: p.chat || null,\n          bookmarkedByMe: false,", "          chat: p.chat || null,\n          read: p.read !== false,\n          bookmarkedByMe: false,"),
          (x) => once(x, "UsernameAvatar, removedTopics,", "UsernameAvatar, removedTopics, readIds, markAllPostsRead,"),
          (x) =>
            once(
              x,
              "forumModuleFilterId, setForumModuleFilterId,\n  };\n\n  if (composingPost) return <NewPostComposer ctx={forumCtx} />;",
              "forumModuleFilterId, setForumModuleFilterId,\n    readIds: ctx.readIds, markAllPostsRead: ctx.markAllPostsRead,\n  };\n\n  if (composingPost) return <NewPostComposer ctx={forumCtx} />;"
            ),
        ]),
    },
    {
      name: "[3] sorotan BARU di daftar forum (Informasi belum dibaca paling kontras)",
      done: (t) => t.includes("const isInfo = p.postType"),
      apply: (t) =>
        chain(t, [
          (x) =>
            inFunction(x, "function PostCard(", (seg) =>
              chain(seg, [
                (y) => once(y, "  const { c, sans, CURRENT_USER, openProfile, avatarFor, deletePost, localReplies, countAllReplies, setEditingPostId } = ctx;\n", S("postcard_consts")),
                (y) => once(y, /        background: c\.card,\n        border: `1px solid \$\{c\.line\}`,\n        cursor: "pointer",\n/, S("postcard_style")),
                (y) => once(y, /[ \t]*<PostTypeBadge ctx=\{ctx\} type=\{p\.postType\} \/>\n/, S("postcard_badge")),
                (y) => once(y, "color: c.ink, lineHeight: 1.5, marginBottom: p.images.length || p.attachment ? 10 : 2 }}>", "color: c.ink, lineHeight: 1.5, fontWeight: unread ? 600 : 400, marginBottom: p.images.length || p.attachment ? 10 : 2 }}>"),
              ])
            ),
          (x) =>
            inFunction(x, "function PostList(", (seg) =>
              chain(seg, [
                (y) =>
                  once(
                    y,
                    "  const allPosts = localPosts;\n",
                    "  const allPosts = localPosts;\n  const unreadCount = localPosts.filter((p) => p.read === false && !(ctx.readIds || {})[p.id]).length;\n"
                  ),
                (y) =>
                  once(
                    y,
                    /[ \t]*<span style=\{\{ fontFamily: sans, fontSize: 11\.5, color: c\.inkFaint, fontStyle: "italic" \}\}>\{localPosts\.length\} post<\/span>\n/,
                    S("postlist_header")
                  ),
              ])
            ),
        ]),
    },
  ]);
}

// ================================================================ /api/forum/feed
function patchFeed() {
  const rel = "src/app/api/forum/feed/route.js";
  runEdits(rel, [
    {
      name: "[3] feed mengirim status baca (read) per post",
      done: (t) => t.includes("forum_read_state"),
      apply: (t) =>
        chain(t, [
          (x) => once(x, "    posts = posts || [];\n", S("feed_read_block")),
          (x) =>
            once(
              x,
              '        chat: p.post_type === "diskusi" ? chat[String(p.id)] || { count: 0, last: null } : null,\n',
              '        chat: p.post_type === "diskusi" ? chat[String(p.id)] || { count: 0, last: null } : null,\n        read: isRead(p),\n'
            ),
          (x) => once(x, "    return NextResponse.json({\n      posts: posts.map((p) => ({", "    return NextResponse.json({\n      readTracking: !!readSet,\n      posts: posts.map((p) => ({"),
        ]),
    },
  ]);
}

// ================================================================ rute post (jenis "informasi")
function patchPostRoutes() {
  for (const rel of ["src/app/api/forum/posts/route.js", "src/app/api/forum/posts/[id]/route.js"]) {
    if (!exists(rel)) {
      note("WARN", rel + " tidak ditemukan");
      continue;
    }
    const t = readText(rel).text;
    if (/["']informasi["']/.test(t)) {
      note("SKIP", rel + ' (sudah menerima "informasi")');
      continue;
    }
    const re = /(\[[^\]]*["']pertanyaan["'][^\]]*?)(\s*\])/;
    if (!re.test(t)) {
      note("WARN", rel + ': tidak ada daftar jenis post yang memuat "pertanyaan" (mungkin tidak ada validasi). Coba buat post Informasi; kalau ditolak, kirim berkas ini ke saya.');
      continue;
    }
    runEdits(rel, [
      {
        name: 'jenis post "informasi" diterima',
        done: () => false,
        apply: (x) => once(x, re, (m, a, b) => a + (/,\s*$/.test(a) ? " " : ", ") + '"informasi"' + b),
      },
    ]);
  }
}

// ================================================================ main
console.log("\nw3study update 3: subject GDA, jenis Informasi, status baca forum\n");
if (!exists("package.json") || !exists("src/app")) {
  console.log("[GAGAL] Jalankan file ini dari folder proyek (yang berisi package.json dan src/app).");
  process.exit(1);
}
console.log("1) Berkas baru");
writeNew("admin-setup/admin_setup_6.sql", S("admin_setup_6_sql"));
writeNew("src/app/api/forum/read/route.js", S("forum_read_route"));
console.log("\n2) Subject GDA");
patchGda();
console.log("\n3) Homepage.jsx (jenis post, status baca, sorotan)");
patchHomepage();
console.log("\n4) /api/forum/feed");
patchFeed();
console.log("\n5) Rute post (jenis Informasi)");
patchPostRoutes();

const count = (k) => results.filter((r) => r === k).length;
console.log("\nRingkasan: " + count("OK") + " berhasil, " + count("SKIP") + " dilewati, " + count("WARN") + " peringatan, " + count("GAGAL") + " gagal.");
if (backupDir) console.log("Cadangan berkas asli: " + backupDir + "\\");
console.log("\nLangkah manual sesudahnya:");
console.log("  a) Supabase > SQL Editor: jalankan isi admin-setup/admin_setup_6.sql (sekali saja).");
console.log("  b) Uji lokal (npm run dev): buat post jenis Informasi dari akun lain, lalu cek sorotan BARU.");
console.log("  c) Commit dan push supaya Vercel deploy.");
if (count("GAGAL") > 0) console.log("\nAda langkah GAGAL di atas. Kirim barisnya ke saya; langkah yang gagal tidak mengubah apa pun, langkah lain tetap diterapkan.");
process.exit(count("GAGAL") > 0 ? 2 : 0);
