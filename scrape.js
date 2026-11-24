const fs = require('fs');
const { firefox } = require('playwright');

const source = process.env.SOURCE || 'Delhi';
const destination = process.env.DESTINATION || 'Indore';
const travelDate = process.env.TRAVEL_DATE || '2026-11-30';
const acOnly = process.env.AC_ONLY !== 'false';

const CITY_IDS = {
  delhi: 733,
  indore: 313,
  mumbai: 462,
  pune: 130,
  bangalore: 122,
  bengaluru: 122,
  hyderabad: 124,
  jaipur: 807,
  agra: 118
};

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
    const apiBuses = [];
    const jsonEndpoints = [];

    // Intercept RedBus internal JSON inventory responses
    page.on('response', async (res) => {
      try {
        const ct = res.headers()['content-type'] || '';
        if (!ct.includes('application/json')) return;
        const url = res.url();
        if (!url.includes('redbus')) return;
        jsonEndpoints.push(`${res.status()} ${url.split('?')[0]}`);

        const data = await res.json().catch(() => null);
        if (!data) return;

        const list =
          (Array.isArray(data.inventories) && data.inventories) ||
          (Array.isArray(data.inv) && data.inv) ||
          (Array.isArray(data.data?.inventories) && data.data.inventories) ||
          (Array.isArray(data.metaData?.inventories) && data.metaData.inventories) ||
          null;

        if (list) {
          for (const item of list) {
            const operator = item.travelsName || item.Tvs || item.operatorName || item.ServiceName || '';
            const busType = item.busType || item.bt || item.BusType || '';
            const fareRaw =
              item.minFare ||
              item.fare ||
              (Array.isArray(item.fareList) ? Math.min(...item.fareList.map(Number).filter(Boolean)) : null);
            const fare = Number(fareRaw);
            const seatsLeft = Number(item.availableSeats ?? item.avSeats ?? item.AvailableSeats);

            if (operator && !Number.isNaN(fare) && fare > 0) {
              apiBuses.push({
                operator: String(operator).trim(),
                busType: String(busType).trim(),
                isAC:
                  item.isAc === true ||
                  (/\bA\/C\b|\bAC\b/i.test(busType) && !/NON[\s-]?A\/?C/i.test(busType)),
                departure: item.departureTime || item.dt || '',
                arrival: item.arrivalTime || item.at || '',
                fare,
                seatsLeft: Number.isNaN(seatsLeft) ? null : seatsLeft
              });
            }
          }
        }
      } catch (_) {}
    });

    const d = new Date(`${travelDate}T00:00:00`);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const formattedDate = `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;

    const fromId = CITY_IDS[source.toLowerCase()];
    const toId = CITY_IDS[destination.toLowerCase()];
    let searchUrl = `https://www.redbus.in/bus-tickets/${encodeURIComponent(source.toLowerCase())}-to-${encodeURIComponent(destination.toLowerCase())}?onward=${formattedDate}&doj=${formattedDate}`;
    if (fromId && toId) {
      searchUrl += `&fromCityName=${encodeURIComponent(source)}&fromCityId=${fromId}&srcCountry=IND&fromCityType=CITY&toCityName=${encodeURIComponent(destination)}&toCityId=${toId}&destCountry=IND&toCityType=CITY&ref=home`;
    }

    console.log('Opening:', searchUrl);
    const response = await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const httpStatus = response ? response.status() : null;

    await page.waitForTimeout(5000);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(800);
    }

    const pageInfo = await page.evaluate(() => {
      const cards = document.querySelectorAll('.bus-item, li.row-sec, ul.bus-items > li, [class*="tupleWrapper"], [class*="busCard"]');
      const domBuses = [];
      cards.forEach((card) => {
        const text = card.innerText || '';
        const operator = card.querySelector('.travels, [class*="travels"]')?.textContent?.trim() || text.split('\n')[0]?.trim() || '';
        const busType = card.querySelector('.bus-type, [class*="bus-type"], [class*="busType"]')?.textContent?.trim() || '';
        const departure = card.querySelector('.dp-time, [class*="dp-time"], [class*="depTime"]')?.textContent?.trim() || '';
        const arrival = card.querySelector('.bp-time, [class*="bp-time"], [class*="arrTime"]')?.textContent?.trim() || '';
        const fareMatch = (card.querySelector('.fare, .seat-fare, [class*="fare"]')?.textContent || text).match(/(?:INR|₹)\s*([\d,]+)/i);
        const seatsMatch = (card.querySelector('.seat-left, [class*="seat-left"], [class*="seatsLeft"]')?.textContent || text).match(/(\d+)\s*Seats?\s*(?:left|available)/i);

        const fare = fareMatch ? parseInt(fareMatch[1].replace(/,/g, ''), 10) : NaN;
        const seatsLeft = seatsMatch ? parseInt(seatsMatch[1], 10) : null;

        if (operator && !Number.isNaN(fare) && fare > 50) {
          domBuses.push({
            operator,
            busType,
            isAC: /\bA\/C\b|\bAC\b/i.test(busType + ' ' + text) && !/NON[\s-]?A\/?C/i.test(busType + ' ' + text),
            departure,
            arrival,
            fare,
            seatsLeft
          });
        }
      });

      return {
        title: document.title,
        finalUrl: location.href,
        bodySnippet: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 350),
        domBuses
      };
    });

    const rawBuses = apiBuses.length ? apiBuses : pageInfo.domBuses;
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

    if (buses.length === 0) {
      snapshot.debug = {
        httpStatus,
        title: pageInfo.title,
        finalUrl: pageInfo.finalUrl,
        rawCountBeforeAcFilter: rawBuses.length,
        jsonEndpoints: jsonEndpoints.slice(0, 10),
        bodySnippet: pageInfo.bodySnippet
      };
    }

    fs.writeFileSync('snapshot.json', JSON.stringify(snapshot, null, 2));
    console.log(`Saved snapshot.json with ${buses.length} AC buses (API: ${apiBuses.length}, DOM: ${pageInfo.domBuses.length}).`);
  } catch (err) {
    console.error('EXACT ERROR:', err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
