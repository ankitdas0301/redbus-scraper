const fs = require('fs');
const { firefox } = require('playwright');

const source = process.env.SOURCE || 'Delhi';
const destination = process.env.DESTINATION || 'Indore';
const travelDate = process.env.TRAVEL_DATE || '2026-11-30';
const acOnly = process.env.AC_ONLY !== 'false';

(async () => {
  const browser = await firefox.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
      viewport: { width: 1366, height: 900 },
      locale: 'en-IN',
      timezoneId: 'Asia/Kolkata'
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const page = await context.newPage();

    const d = new Date(`${travelDate}T00:00:00`);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const formattedDate = `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
    const searchUrl = `https://www.redbus.in/bus-tickets/${encodeURIComponent(source.toLowerCase())}-to-${encodeURIComponent(destination.toLowerCase())}?onward=${formattedDate}&doj=${formattedDate}`;

    console.log('Opening:', searchUrl);
    const response = await page.goto(searchUrl, { waitUntil: 'commit', timeout: 30000 });
    console.log('HTTP Status:', response ? response.status() : 'no response');

    await page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
    console.log('Page Title:', await page.title().catch(() => 'unavailable'));

    await page.waitForSelector('.bus-item, [class*="bus-item"], li.row-sec', { timeout: 25000 }).catch(() => {});

    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(700);
    }

    const rawBuses = await page.evaluate(() => {
      const cards = document.querySelectorAll('.bus-item, li.row-sec');
      const results = [];
      cards.forEach((card) => {
        const operator = card.querySelector('.travels, [class*="travels"]')?.textContent?.trim() || '';
        const busType = card.querySelector('.bus-type, [class*="bus-type"]')?.textContent?.trim() || '';
        const departure = card.querySelector('.dp-time, [class*="dp-time"]')?.textContent?.trim() || '';
        const arrival = card.querySelector('.bp-time, [class*="bp-time"]')?.textContent?.trim() || '';
        const fareText = card.querySelector('.fare span, .seat-fare, [class*="fare"]')?.textContent || '';
        const seatsText = card.querySelector('.seat-left, [class*="seat-left"]')?.textContent || '';

        const fare = parseInt(fareText.replace(/[^\d]/g, ''), 10);
        const seatsLeft = parseInt(seatsText.replace(/[^\d]/g, ''), 10);

        if (operator && !Number.isNaN(fare)) {
          results.push({
            operator,
            busType,
            isAC: /\bA\/C\b|\bAC\b/i.test(busType) && !/NON[\s-]?A\/?C/i.test(busType),
            departure,
            arrival,
            fare,
            seatsLeft: Number.isNaN(seatsLeft) ? null : seatsLeft
          });
        }
      });
      return results;
    });

    const buses = acOnly ? rawBuses.filter((b) => b.isAC) : rawBuses;
    const fares = buses.map((b) => b.fare).sort((a, b) => a - b);
    const operators = new Set(buses.map((b) => b.operator)).size;
    const lowest = fares.length ? fares[0] : null;
    const median = fares.length
      ? (fares.length % 2 === 1
          ? fares[Math.floor(fares.length / 2)]
          : Math.round((fares[fares.length / 2 - 1] + fares[fares.length / 2]) / 2))
      : null;

    const busesWithSeats = buses.filter((b) => b.seatsLeft !== null);
    const estOcc = busesWithSeats.length
      ? Math.round((busesWithSeats.reduce((sum, b) => sum + Math.max(0, 36 - b.seatsLeft) / 36, 0) / busesWithSeats.length) * 100)
      : null;

    const snapshot = {
      source,
      destination,
      travelDate,
      collectedAt: new Date().toISOString(),
      summary: { acBuses: buses.length, operators, lowest, median, estOcc },
      buses
    };

    fs.writeFileSync('snapshot.json', JSON.stringify(snapshot, null, 2));
    console.log(`Saved snapshot.json with ${buses.length} AC buses.`);
  } catch (err) {
    console.error('EXACT ERROR:', err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
