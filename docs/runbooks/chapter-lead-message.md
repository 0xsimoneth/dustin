# Message to the chapter lead: the two-fixture reading of week 3

For the builder to send. It asks the chapter lead to confirm in writing how the SOW's week-3 wording is read (canonical decision 3 in [`docs/README.md`](../README.md)); the evidence package lists this confirmation as pending ([`evidence/README.md`](../../evidence/README.md#pending-the-builders-actions)). Send one of the two versions below, in the language you use with the chapter lead, from your usual channel. Replace `<...>` before sending; the links are to the public repository.

After the reply: keep the reply itself off the repository (it names a person), and tell the agent the date. The agent then replaces `<pending: chapter lead's acknowledgement>` in `evidence/README.md` and `evidence/completion-report.md` with "acknowledged in writing on <date>; the reply is held off-repository", as the SOW copy does for the signed original.

## English

> Subject: Dustin (Instaward): please confirm the fixture reading for week 3
>
> Hello,
>
> One wording in the Dustin SOW needs your written confirmation before I send the completion report.
>
> Week 3 of the SOW expects "the messy fixture closed" and, on the same fixture, the deliberately illiquid asset "exiting through the unclosable path with a stated reason". Both cannot happen on one account: a balance that cannot be disposed of keeps its trustline, and a trustline blocks the account merge, so an account holding it can never be closed. I therefore used two fixtures, built from the same code:
>
> 1. **`messy`, the success-metric account.** 4 trustlines with dust (1 of them sponsored by a separate reserve sponsor), 2 open offers, 1 data entry, and zero spendable XLM (balance exactly at the minimum reserve). Every balance can be disposed of, and Dustin closes it fully, with every fee paid by a sponsor; this is the account that SOW Appendix B is checked on.
> 2. **`edge`, the unclosable case.** A separate account whose asset is frozen by its issuer and has no market. Dustin stops before signing anything and names the reason (`TRUSTLINE_NOT_AUTHORIZED`, with the issuer and a remedy); with `--partial` it cleans up everything else and leaves that balance, and the receipt lists it as not closed.
>
> "0 XLM" is read as zero spendable XLM. A literal 0.0000000 XLM account (fully sponsored) was also closed, as an extra test.
>
> The evidence:
> - the metric close: <https://github.com/0xsimoneth/dustin/blob/main/evidence/runs/20260929T111408Z-e4-cli/summary.md>
> - the unclosable exit: <https://github.com/0xsimoneth/dustin/blob/main/evidence/runs/20260928T125414Z-edge-frozen/summary.md>
> - the evidence package, row by row against the SOW: <https://github.com/0xsimoneth/dustin/blob/main/evidence/README.md>
>
> Could you reply to confirm that this two-fixture reading meets the week-3 expected output and the binary success metric? A one-line reply is enough. If you read it differently, tell me what you need and I will adjust before the final deadline (2026-10-22).
>
> Thank you,
> <your name or handle>

## Türkçe

> Konu: Dustin (Instaward): 3. hafta fixture yorumunun onayı
>
> Merhaba,
>
> Dustin SOW'undaki bir ifade için, tamamlama raporunu göndermeden önce yazılı onayınıza ihtiyacım var.
>
> SOW'un 3. haftası hem "messy fixture'ın kapatılmasını" hem de aynı fixture üzerinde, bilerek likiditesiz bırakılmış varlığın "gerekçesi belirtilerek kapatılamaz yoldan çıkmasını" bekliyor. İkisi aynı hesapta birlikte olamaz: elden çıkarılamayan bir bakiye trustline'ını tutar, trustline da hesap birleştirmeyi (merge) engeller; böyle bir bakiyeyi taşıyan hesap hiçbir zaman kapatılamaz. Bu yüzden aynı kodla kurulan iki fixture kullandım:
>
> 1. **`messy`, başarı ölçütünün hesabı.** Toz bakiyeli 4 trustline (1'i ayrı bir rezerv sponsoru tarafından sponsorlu), 2 açık teklif, 1 data girdisi ve harcanabilir XLM'i sıfır (bakiye tam minimum rezervde). Her bakiye elden çıkarılabiliyor ve Dustin hesabı, bütün ücretleri bir sponsor ödeyerek tamamen kapatıyor; SOW Ek B bu hesap üzerinde kontrol ediliyor.
> 2. **`edge`, kapatılamaz durum.** Varlığı ihraççısı tarafından dondurulmuş ve piyasası olmayan ayrı bir hesap. Dustin hiçbir şey imzalamadan durur ve gerekçeyi yazar (`TRUSTLINE_NOT_AUTHORIZED`, ihraççı ve çözüm önerisiyle); `--partial` ile geri kalan her şeyi temizler, o bakiyeyi bırakır ve makbuz onu kapatılmamış olarak listeler.
>
> "0 XLM" harcanabilir XLM'in sıfır olması olarak okundu. Ek bir test olarak, tamamen sponsorlu ve bakiyesi gerçekten 0.0000000 XLM olan bir hesap da kapatıldı.
>
> Kanıtlar:
> - başarı ölçütü kapanışı: <https://github.com/0xsimoneth/dustin/blob/main/evidence/runs/20260929T111408Z-e4-cli/summary.md>
> - kapatılamaz çıkış: <https://github.com/0xsimoneth/dustin/blob/main/evidence/runs/20260928T125414Z-edge-frozen/summary.md>
> - SOW'a satır satır eşlenmiş kanıt paketi: <https://github.com/0xsimoneth/dustin/blob/main/evidence/README.md>
>
> Bu iki fixture yorumunun 3. haftanın beklenen çıktısını ve ikili başarı ölçütünü karşıladığını yanıtla onaylayabilir misiniz? Tek satırlık bir yanıt yeterli. Farklı okuyorsanız neye ihtiyacınız olduğunu yazın; son teslim tarihinden (2026-10-22) önce düzeltirim.
>
> Teşekkürler,
> <adınız veya kullanıcı adınız>
