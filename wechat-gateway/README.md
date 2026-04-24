# WeChat Gateway

一个最小可上线的微信公众号 API 固定出口网关。

## 用途

把所有需要微信公众号官方白名单 IP 的请求，从 Vercel 主应用迁移到这台固定公网 IP 的 VPS 上。

调用链会变成：

`Niche -> wechat-gateway -> 微信官方 API`

## 环境变量

- `PORT`
  默认 `8787`
- `GATEWAY_TOKEN`
  建议必填。主应用通过 `Authorization: Bearer <token>` 调用网关

## Docker 部署

```bash
docker build -t wechat-gateway .
docker run -d \
  --name wechat-gateway \
  -p 8787:8787 \
  -e GATEWAY_TOKEN=replace-with-a-long-random-string \
  wechat-gateway
```

## 健康检查

```bash
curl http://your-server-ip:8787/health
```

## 主应用新增环境变量

```env
WECHAT_GATEWAY_URL=http://your-server-ip:8787
WECHAT_GATEWAY_TOKEN=replace-with-a-long-random-string
```

## 当前支持

- `POST /v1/access-token`
- `POST /v1/material/upload-url`
- `POST /v1/draft/add`
- `POST /v1/freepublish/batchget`
- `POST /v1/datacube/articlesummary`
- `POST /v1/datacube/articletotal`
