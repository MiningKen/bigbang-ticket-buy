import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { SEATING_MODES, SESSION_CHOICES, updateEnvValues } from './sessions.js';

console.log('請選擇要監看的 BIGBANG 台北場次：');
for (const [index, session] of SESSION_CHOICES.entries()) {
  console.log(`  ${index + 1}. ${session.label}`);
}

const readline = createInterface({ input, output });
const answer = await readline.question('輸入 1、2 或 3：');
const selection = SESSION_CHOICES[Number.parseInt(answer, 10) - 1];
if (!selection) {
  console.error('選擇無效，設定沒有變更。');
  readline.close();
  process.exitCode = 1;
} else {
  const countAnswer = await readline.question('票數（1–4）：');
  const ticketCount = Number.parseInt(countAnswer, 10);
  if (!Number.isInteger(ticketCount) || ticketCount < 1 || ticketCount > 4) {
    console.error('票數必須是 1–4，設定沒有變更。');
    readline.close();
    process.exitCode = 1;
  } else {
    console.log('\n請選擇連號策略：');
    for (const [index, mode] of SEATING_MODES.entries()) {
      console.log(`  ${index + 1}. ${mode.label}`);
    }
    const modeAnswer = await readline.question('輸入 1、2 或 3：');
    const seatingMode = SEATING_MODES[Number.parseInt(modeAnswer, 10) - 1];

    if (!seatingMode) {
      readline.close();
      console.error('連號策略無效，設定沒有變更。');
      process.exitCode = 1;
    } else {
      const autoAnswer = await readline.question(
        '若已閱讀並接受活動與會員條款，要在選票後自動按「下一步」嗎？(y/N)：',
      );
      readline.close();
      const autoAdvance = /^(?:y|yes)$/i.test(autoAnswer.trim());
      const envPath = '.env';
      const contents = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
      writeFileSync(
        envPath,
        updateEnvValues(contents, {
          TARGET_DATE: selection.date,
          INTERNAL_SESSION_ID: selection.internalSessionId,
          TICKET_COUNT: ticketCount,
          SEATING_MODE: seatingMode.id,
          ACCEPT_TERMS: autoAdvance,
          AUTO_ADVANCE: autoAdvance,
        }),
      );
      console.log(
        `已選擇 ${selection.label}、${ticketCount} 張、${seatingMode.label}；自動下一步：${autoAdvance ? '開啟' : '關閉'}。執行 npm run watch 即可開始監看。`,
      );
    }
  }
}
