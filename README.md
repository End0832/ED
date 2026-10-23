# Notes (from EcoleDirecte)

A cozy web interface to view your EcoleDirecte grades, with instant averages and an overall average.

Live: https://end0832.github.io/ED

## ⚠️ Read this first

This is a messy, half vibe-coded, temporary personal project, made for me and a few friends. It is **not** meant to be usable by everyone.

- It's tailored to my school's grade format, which changes every year. I patch it manually each time.
- The code is trash.
- No support, no guarantees, no roadmap.
- This repo will be deleted once I no longer need it.

## What it does

- Log in with your EcoleDirecte account
- See all your grades in a clean interface
- Averages are computed instantly (EcoleDirecte only refreshes them periodically)
- Shows the overall average
- Installable as a PWA

## Privacy

Because of CORS, requests go through a Cloudflare worker. Its code is shared (backend.js), and nothing in the source stores anything. But I can't prove what actually runs on the server: you have to take my word that I store nothing.

## Copying

If you still want to copy it, feel free. No license, no tutorial.
