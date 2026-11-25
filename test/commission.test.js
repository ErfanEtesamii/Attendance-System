'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dealFromItems, buildLeaderboards, commissionForDeal, discountRate, amountRate, nextAmountTier } = require('../src/utils/commission');

test('پورسانت: پله‌های درصد تخفیف', () => {
  assert.equal(discountRate(0), 5);
  assert.equal(discountRate(1), 4); assert.equal(discountRate(7), 4);
  assert.equal(discountRate(8), 3); assert.equal(discountRate(15), 3);
  assert.equal(discountRate(16), 2); assert.equal(discountRate(23), 2);
  assert.equal(discountRate(24), 1); assert.equal(discountRate(30), 1);
  assert.equal(discountRate(30.5), 0);
});
test('پورسانت: پله‌های مبلغ فاکتور', () => {
  assert.equal(amountRate(150_000_000), 1); assert.equal(amountRate(150_000_001), 2);
  assert.equal(amountRate(250_000_001), 3); assert.equal(amountRate(350_000_001), 4);
  assert.equal(amountRate(450_000_001), 5); assert.equal(amountRate(5_100_000_000), 5);
});
test('پورسانت: جمع دو درصد و قاعده‌ی تخفیف بیش از ۳۰٪', () => {
  assert.deepEqual(commissionForDeal({ amountToman: 300_000_000, discountPercent: 5 }), { eligible: true, discountRate: 4, amountRate: 3, ratePercent: 7, commissionToman: 21_000_000 });
  assert.equal(commissionForDeal({ amountToman: 300_000_000, discountPercent: 31 }).commissionToman, 0);
  assert.equal(commissionForDeal({ amountToman: 500_000_000, discountPercent: 0 }).ratePercent, 10);
});
test('پورسانت: پله‌ی بعدی مبلغ', () => {
  assert.deepEqual(nextAmountTier(100_000_000), { threshold: 150_000_000, rate: 2 });
  assert.equal(nextAmountTier(460_000_000), null);
});

test('لیدربرد: مبلغ دیگران به پاسخ نمی‌رود، رتبه‌ها درست است', () => {
  const rows = [{ userId: 1, name: 'الف', count: 3, amountToman: 900 }, { userId: 2, name: 'ب', count: 5, amountToman: 400 }, { userId: 3, name: 'ج', count: 1, amountToman: 700 }];
  const b = buildLeaderboards(rows, 3);
  assert.deepEqual(b.byCount.map((x) => x.userId), [2, 1, 3]);
  assert.deepEqual(b.byAmount.map((x) => [x.userId, x.amountToman]), [[1, null], [3, 700], [2, null]]);
  assert.ok(!JSON.stringify(b).includes('900') && !JSON.stringify(b).includes('400'));
  assert.equal(buildLeaderboards(rows, 3, { canSeeAll: true }).byAmount[0].amountToman, 900);
});

test('معامله از ردیف‌های فاکتور دیدار: ریال⇒تومان، تخفیف درصدی و مبلغی، حذف هزینه‌ی ارسال', () => {
  const d = dealFromItems([
    { Title: 'گلستان ۴', UnitPrice: 70_000_000, Quantity: 2, DiscountPercent: 10, Discount: 14_000_000 },
    { Title: 'اجیل مخلوط', UnitPrice: 50_000_000, Quantity: 30, Discount: 0, DiscountPercent: 0 },
    { Title: 'هزینه ارسال', UnitPrice: 5_000_000, Quantity: 1 },
  ]);
  assert.equal(d.amountToman, (140_000_000 - 14_000_000 + 1_500_000_000) / 10);
  assert.equal(d.discountPercent, 0.9); // ۱۴ میلیون از ۱٫۶۴ میلیارد
});
