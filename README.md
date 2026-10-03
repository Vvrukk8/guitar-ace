# Guitar Ace

iPhone-friendly web app: a horizontal **9-bar LED tuner** driven by your **microphone** hearing a guitar string.

```
[ red ][ red ][ yellow ][ yellow ][ GREEN ][ yellow ][ yellow ][ red ][ red ]
  far     near    mid      near    IN TUNE    near      mid      near   far
  flat    flat    flat     flat               sharp     sharp    sharp  sharp
```

Center green is taller. Flat lights the left, sharp lights the right.

## Behavior

1. Set **reference A4** (430–450 Hz, default 440) with − / +, the number, or the slider.
2. Tap **Enable Microphone** and allow access.
3. Play one string toward the phone. Pitch detection shows the note and cents.
4. The matching zone LED lights:
   - Flat → left reds and yellows
   - In tune (about ±5 cents) → center GREEN
   - Sharp → right yellows and reds
5. **Sensitivity** slider: higher hears quieter notes.
6. Quiet for a moment clears the LEDs. **Reset** clears the readout.

## Files

| Path | Role |
|------|------|
| `index.html` | App shell |
| `styles.css` | Same dark stage as Drum Ace, blue Les Paul background |
| `app.js` | `getUserMedia` + pitch → LED zones |
| `bg-lespaul.jpg` | Background |

## Run (Mobile Safari)

Mic access needs **HTTPS** or `localhost`.

```bash
cd /workspace/guitar-ace
python3 -m http.server 8771
```

Add to Home Screen for a fuller app feel.
