# Quickstart Deployment (PM2 + Nginx)

This is a shortcut on top of `DEPLOY_TIMEWEB.md`.

## 1) Build app

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
npm run build
```

## 2) Start processes via PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
pm2 status
```

## 3) Install Nginx config

```bash
sudo cp deploy/nginx/ruletka.conf /etc/nginx/sites-available/ruletka
sudo ln -s /etc/nginx/sites-available/ruletka /etc/nginx/sites-enabled/ruletka
sudo nginx -t
sudo systemctl reload nginx
```

## 4) Enable SSL

```bash
sudo certbot --nginx -d wheel.example.com -d api.example.com
```

## 5) Health checks

```bash
curl https://api.example.com/health
pm2 logs ruletka-api
pm2 logs ruletka-bot
```

## 6) Админ: просмотр крутивших и сброс

Список SQL-команд по шагам (подключение `psql`, выборки, удаление по Telegram ID, полное обнуление `ShopNotification`/`Win`/`Spin`/`User`) описан в **`DEPLOY_TIMEWEB.md`**, подраздел **8.1**. На Beget — то же самое в **`DEPLOY_BEGET.md`**, раздел **10**.
