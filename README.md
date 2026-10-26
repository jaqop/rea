# REA Narrative — هندسة عكسية للروايات

نسخة مستقلة من [REA](https://github.com/morluto/rea)، مخصصة للتحقيق في بناء الكتب والروايات بالأدلة. تمنح مساعدك أدوات لحفظ النص والاستشهادات والمشاهد والقرارات والآليات السردية والأسئلة المفتوحة وتتبع العلاقات بينها.

هذه النسخة تعمل للكتب. نقطة التشغيل وحزمة التثبيت والاختبارات مخصصة للمسار السردي. المصدر البرمجي الأصلي محفوظ للرجوع إليه، ولا يُحمّل أو يُوزّع مع الحزمة الجديدة.

اسم الأمر هو `rea-narrative` لتجنب التعارض مع الأمر `rea` الذي تستخدمه حزمة تحليل البرامج الأصلية. يمكن تثبيت النسختين معًا دون حذف إحداهما أو استخدام `--force`.

## التثبيت على أي جهاز

تحتاج إلى Git وNode.js 24 أو أحدث. لا توجد تبعيات npm أو خطوات بناء أو محركات تفكيك برامج مطلوبة.


    git clone https://github.com/jaqop/rea.git
    cd rea
    npm test
    node narrative/cli.mjs --help
    npm install --global .
    rea-narrative --help

أو التثبيت مباشرة من GitHub:

    npm install --global git+https://github.com/jaqop/rea.git

لا تستخدم أمر تثبيت rea-agents الأصلي؛ فهو يثبت منتج تحليل البرامج، وليس هذه النسخة.

## ربطه بمساعدك

    rea-narrative config --home "/absolute/path/to/my-investigations"

على Windows استخدم مسارًا مثل D:/Books/investigations. يعطي الأمر إعداد MCP يتضمن المسارات المطلقة لهذا الجهاز. أضفه إلى إعدادات MCP في مساعدك ثم أعد الاتصال. لا يغيّر الأمر إعدادات التطبيقات تلقائيًا.

    rea-narrative mcp --home "/absolute/path/to/my-investigations"
    rea-narrative workflow

اقرأ [مهارة التحقيق الروائي](narrative/skills/reverse-engineer-novels/SKILL.md)، أو اطبعها بالأمر الأخير وأعطها للمساعد. اطلب منه التحقيق في روايتك بالأدلة، مع فصل الملاحظة عن الاستنتاج، وتسجيل تفسيرات منافسة واختبارات للآليات المستخرجة.

## تجربة سريعة

    npm run demo
    rea-narrative import "/absolute/path/to/book.txt" --title "عنوان الكتاب" --home "/absolute/path/to/my-investigations"
    rea-narrative tools
    rea-narrative call inspect_book --input arguments.json --home "/absolute/path/to/my-investigations"

يعيد الاستيراد book_id. ضع الهوية الفعلية في ملف arguments.json بهذا الشكل: { "book_id": "book_..." }. استخدم أدوات MCP بدل كتابة الأوامر عندما يكون المساعد متصلًا.

[دليل الاستخدام الكامل](docs/narrative-guide.md) · [البنية وحدود التحقق](docs/NARRATIVE-ARCHITECTURE.md)

## الإمكانات

في مسار 0.2 توجد 41 أداة مشتركة بين CLI وMCP: تحقيق مصدر واحد، وأدلة تحليل متخصصة، ومساحة تصميم تجمع مصادر متعددة وتحتفظ بمراجعات الخطة.

- استيراد TXT وMarkdown بترميز UTF-8، مع حفظ النص ومواضع المقاطع وبصمة المصدر؛ يدعم العربية والإنجليزية.
- البحث الحرفي والقراءة المرتبة على صفحات، والتحقق من تطابق الاقتباس وموضعه.
- قراءة نطاق نصي مباشر والبحث عن مواضع التطابق مع سياقها، حتى إذا كان الكتاب فقرة ضخمة؛ دون تغيير المصدر أو إزاحاته.
- أدلة أسئلة وتحليلات مدعومة بادعاءات لأربعة مجالات: `worldbuilding` و`character-development` و`plot` و`characterisation`.
- حفظ الملاحظات والاستنتاجات والفرضيات بأدلتها والأدلة المعارضة.
- تسجيل منظور المشهد وأهدافه وتغير المعرفة والقرار والنتيجة والاعتماد على مشاهد أخرى.
- تسجيل آليات بناء بشروط وخطوات وتفسيرات منافسة وتنبؤات واختبارات وقيود مجردة للنقل إلى عمل جديد.
- تتبع العلاقات المعلنة، وإبقاء المجهولات ظاهرة، وفحص سلامة التحقيق وتغطية التعليقات.
- تصدير التحقيق واستيراده على جهاز آخر، وإعداد موجز نقل يستبعد المقاطع الأصلية ويعرض القيود التي أدخلها المحلل.
- مساحة عمل تحفظ نسخًا ثابتة من تحقيقات الكتب، وتركيب مقترح يجمع مساهمات فعلية من كتابين على الأقل مع مراجعة التوافق والتعارضات وحلولها.
- تخطيط طاقم `crossover` بأصوله المعلنة، أو طاقم `original-inspired` بأسماء جديدة وتكييفات صريحة، انطلاقًا من تحليلات الشخصيات.
- إعلان حالة العالم والشخصيات وخطة أحداث بشروط وآثار واعتمادات، وفحص الاتساق داخل الفروع السببية المعلنة.
- إصلاح سجلات الخطة بمراجعات مشروطة بالإصدار الحالي مع حفظ النسخ السابقة، وتصدير مساحة العمل كاملة لاستئنافها على جهاز آخر.

ابدأ بتحقيق كل كتاب وتسجيل تحليلاته، ثم `create_workspace` و`record_synthesis` و`cast_character` و`set_story_state` و`record_story_event`. راجع `verify_workspace`، وأصلح السجل عبر `revise_workspace_record`، واستخرج `workspace_brief`. يعرض [الدليل](docs/narrative-guide.md) الحقول ومثالًا متصلًا؛ الأوامر لا تؤلف الرواية تلقائيًا. يمكن للمؤلف طلب كتابة أصلية من المساعد المتصل بعد مراجعة التصميم.

## الحدود

مهلة إعادة الصياغة الافتراضية تتدرج بمقدار 120 ثانية لكل 384 بايت من المدخل المحمي إلى حد 30 دقيقة؛ يمكن ضبط `REA_OUTPUT_TIMEOUT_MS` بين 1000 و1800000 مللي ثانية. تعرض النتيجة الميزانية الفعلية. تخطي WindowsApps في البحث التلقائي عن Python لا يغني عن اختيار بيئة افتراضية صريحة. تمرير نص محمي فقط يعاد دون نموذج بوسم `protected_text_unchanged`، وليس شهادة إعادة صياغة أو معنى. انزياح زمني عربي لوحظ في تجربة نموذجية رغم نجاح البوابات؛ الحارس اللفظي الإضافي جزئي ولا يثبت الاستلزام الدلالي أو إزالة علامة إحصائية.

للمزود الاختياري اختر Python 3.11 في venv بمسار مطلق؛ التشغيل المعزول لا يرى تثبيت pip --user. يعرض فحص القدرات المسار المحسوم ويميز المفسر المفقود من تعطل الجسر. [دليل الإعداد](docs/narrative-guide.md) يحدد إصدارات Reweave/LaMa/Torch وأوامر تنزيل نماذج Ollama الصريحة؛ لا يثبت npm هذه المحركات أو الأوزان. التفعيل الفعلي يحتاج فحصًا وتجربة، ولا يُفترض اكتماله. إعادة الصياغة مقيدة بـ4096 بايت UTF-8 لكل استدعاء وبوابات لكل جزء، دون ضمان المعنى. الصور يجب أن تكون RGB/RGBA؛ يحفظ الناتج alpha/ICC ولا يستبدل الملفات.

أدوات الإنهاء: `output_capabilities`, `inspect_output_text`, `finalize_output_text`, `rewrite_output_text`, `restore_output_image`. لإنهاء مسودة جديدة دون نموذج: `rea-narrative finalize draft.md --output final.md`؛ يجب ألا يكون ملف الناتج موجودًا. استخدم أداة النص عند الحاجة إلى نطاقات حماية صريحة للاقتباس.

تُنهى المخرجات النثرية الجديدة الموجهة للقارئ بخطوة تنظيف Unicode محدودة، مع حماية العربية واتجاه النص والكود والروابط والاقتباسات الكتلية في Markdown والنطاقات التي تحميها صراحة. لا تطبقها على المصادر أو الاستشهادات أو JSON البروتوكول أو ملفات التصدير. إعادة الصياغة المحلية عبر Reweave اختيارية وتحتاج Python وOllama ونماذج محلية منفصلة؛ LaMa للصور فقط. افحص القدرات الفعلية قبل الاستعمال؛ وجود الشفرة لا يعني جاهزية النماذج. لا يثبت التنظيف إزالة علامة إحصائية أو حفظ المعنى، ولا يثبت أن نصًا بشري التأليف.

يمكن تجميع أجزاء العمل نفسه أو طبعاته بـ `source_work_ids` عند إنشاء المساحة و`work_id` عند إضافة مصدر؛ البصمة وحدها تميز النص، لا العمل الببليوغرافي. يرفض التركيب مساهمات من عمل معلن واحد. تدعم الخطة أيضًا قوس تغير معلنًا للشخصية، وروابط قيود العالم، وتسميات التسلسلات. يعرض `design_review` تنبيهات بنيوية، ولا يثبت أثر القيد أو معقولية التحول النفسي.

تقرأ 0.2 ملفات 0.1 القديمة، لكن ملفات 0.2 التي تستخدم التحليلات أو `source_spans` لا تفتح في 0.1.x؛ لا ترجع مجلد بياناتك الخاص إلى نسخة أقدم. وقد ترفض المدققات الأشد في النسخة الحالية لقطات 0.2 تجريبية غير منشورة؛ احتفظ بنسخ احتياطية قبل النقل.

المساعد المتصل هو الذي يقرأ ويفسر ويكتب إذا طلبت ذلك. هذه الحزمة لا تحتوي نموذج لغة ولا تولّد رواية بمفردها. صحة الاقتباس لا تثبت صحة تفسيره؛ الآليات تظل فرضيات غير مختبرة، ولا توجد تجربة قراء أو شهادة جودة أدبية مدمجة.

لا يوجد استيراد EPUB أو PDF أو DOCX أو OCR حاليًا. التحويل إلى نص يتم خارج المشروع مع مراجعة ترتيب النص. الحد لكل ملف أو تحقيق محفوظ هو 16 MiB؛ التحقيق يحتفظ بالنص ومقاطعه وأدلته، ولذلك قد تحتاج الكتب الطويلة إلى تقسيم. عناوين الفصول وتقسيم الفقرات تقريبيان، ولا يثبتان حدود المشاهد.

البيانات محلية في --home، أو .rea-narrative داخل مجلد التشغيل. مساحة العمل تنسخ تحقيقات المصادر كاملة، ويشمل حد 16 MiB جميع هذه النسخ والخطة. تصدير التحقيق أو مساحة العمل يتضمن النصوص الكاملة؛ انقله بصورة خاصة. رفع البرنامج إلى GitHub لا يرفع كتبك وتحقيقاتك تلقائيًا.

التحقق يفحص الحقائق النصية التي أعلنتها وروابط المصادر فقط. لا يكتشف كل معرفة ضمنية أو دافع أو تعارض نفسي، ولا يثبت توافق عالمين أو أصالة الطاقم. النسخة الثابتة من المصدر لا تتحدث عند تعديل تحقيقه الحي؛ لمقارنة نسخة أخرى أنشئ مساحة جديدة. لا يوجد استيراد XML أو محرك فهم شامل للرواية.

## English

REA Narrative is a dependency-free Node.js 24+ CLI and stdio MCP server for evidence-centered investigation of novels. Your assistant supplies interpretation; the runtime preserves source identity, checks exact citations, stores narrative records, traces declared dependencies and exports portable investigations. It does not recover authorial intent or guarantee literary quality.

Version 0.2 adds four analysis focuses, exact source-range access, and portable multi-book design workspaces. Frozen source snapshots support qualified references, two-book synthesis proposals, explicit crossover or original-inspired casting, declared causal-state checks and retained CAS revisions. The 41 tools do not validate unstated psychology or semantic compatibility. Workspace exports include full source texts; transfer them privately, separately from code.

MIT. Original REA attribution is retained. Upstream package metadata, README and contributor guidance are archived under docs/upstream/. Historical software source is not covered by narrative tests. Do not merge upstream package or publishing configuration blindly into this fork.
