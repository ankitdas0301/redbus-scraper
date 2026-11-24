name: Scrape RedBus Fares

on:
  schedule:
    - cron: '30 3 * * *'
  workflow_dispatch:
    inputs:
      source:
        description: 'Source City'
        default: 'Delhi'
      destination:
        description: 'Destination City'
        default: 'Indore'
      travelDate:
        description: 'Travel Date (YYYY-MM-DD)'
        default: '2026-11-30'

permissions:
  contents: write

jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Check RedBus reachability
        run: curl -I --max-time 12 -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0" "https://www.redbus.in/" || echo "CURL_BLOCKED_OR_TIMED_OUT"

      - name: Install dependencies & Firefox
        run: |
          npm install
          npx playwright install --with-deps firefox

      - name: Run RedBus Scraper
        env:
          SOURCE: ${{ github.event.inputs.source || 'Delhi' }}
          DESTINATION: ${{ github.event.inputs.destination || 'Indore' }}
          TRAVEL_DATE: ${{ github.event.inputs.travelDate || '2026-11-30' }}
        run: node scrape.js

      - name: Save snapshot.json to repo
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add snapshot.json
          git diff --staged --quiet || git commit -m "Update RedBus snapshot"
          git push
