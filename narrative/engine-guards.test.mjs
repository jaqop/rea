import test from 'node:test';
import assert from 'node:assert/strict';
import {createBorrowingGuard} from './engine-guards.mjs';
test('borrowing checks source-wide eight-word runs but exempts pre-existing target wording',()=>{
  const source='The narrow bridge fell beneath the exhausted riders at dawn. A separate ancient sentence remains in place.';
  const check=createBorrowingGuard(source,'The narrow bridge fell beneath the exhausted riders at dawn.');
  assert.equal(check('The narrow bridge fell beneath the exhausted riders at dawn.').rejected.length,0);
  const other=createBorrowingGuard(source,'I wait by the door.');
  assert.ok(other('The narrow bridge fell beneath the exhausted riders at dawn.').rejected.length>0);
  assert.ok(other('I see the narrow bridge fell beneath the exhausted riders at dawn.').review.length>0);
});
test('Arabic and English normalization detects wording without changing caller strings',()=>{
  const source='رَأيتُ رجلا عند الباب ثم جاء رجل آخر من الطريق القديم';
  const candidate='رأيت رجلا عند الباب ثم جاء رجل آخر من الطريق القديم';
  const check=createBorrowingGuard(source,'نص مستقل.');
  assert.ok(check(candidate).rejected.length>0);assert.equal(candidate,'رأيت رجلا عند الباب ثم جاء رجل آخر من الطريق القديم');
});
