# REA Narrative — هندسة عكسية للروايات

نسخة مستقلة من [REA](https://github.com/morluto/rea)، مخصصة للتحقيق في بناء الكتب والروايات بالأدلة. تمنح مساعدك أدوات لحفظ النص والاستشهادات والمشاهد والقرارات والآليات السردية والأسئلة المفتوحة وتتبع العلاقات بينها.

هذه النسخة تعمل للكتب. نقطة التشغيل وحزمة التثبيت والاختبارات مخصصة للمسار السردي. المصدر البرمجي الأصلي محفوظ للرجوع إليه، ولا يُحمّل أو يُوزّع مع الحزمة الجديدة.

## التثبيت على أي جهاز

تحتاج إلى Git وNode.js 24 أو أحدث. لا توجد تبعيات npm أو خطوات بناء أو محركات تفكيك برامج مطلوبة.


    git clone https://github.com/jaqop/rea.git
    cd rea
    npm test
    node narrative/cli.mjs --help
    npm install --global .
    rea --help

أو التثبيت مباشرة من GitHub:

    npm install --global git+https://github.com/jaqop/rea.git

لا تستخدم أمر تثبيت rea-agents الأصلي؛ فهو يثبت منتج تحليل البرامج، وليس هذه النسخة.

## ربطه بمساعدك

    rea config --home "/absolute/path/to/my-investigations"

على Windows استخدم مسارًا مثل D:/Books/investigations. يعطي الأمر إعداد MCP يتضمن المسارات المطلقة لهذا الجهاز. أضفه إلى إعدادات MCP في مساعدك ثم أعد الاتصال. لا يغيّر الأمر إعدادات التطبيقات تلقائيًا.

    rea mcp --home "/absolute/path/to/my-investigations"
    rea workflow

اقرأ [مهارة التحقيق الروائي](narrative/skills/reverse-engineer-novels/SKILL.md)، أو اطبعها بالأمر الأخير وأعطها للمساعد. اطلب منه التحقيق في روايتك بالأدلة، مع فصل الملاحظة عن الاستنتاج، وتسجيل تفسيرات منافسة واختبارات للآليات المستخرجة.

## تجربة سريعة

    npm run demo
    rea import "/absolute/path/to/book.txt" --title "عنوان الكتاب" --home "/absolute/path/to/my-investigations"
    rea tools
    rea call inspect_book --input arguments.json --home "/absolute/path/to/my-investigations"

يعيد الاستيراد book_id. ضع الهوية الفعلية في ملف arguments.json بهذا الشكل: { "book_id": "book_..." }. استخدم أدوات MCP بدل كتابة الأوامر عندما يكون المساعد متصلًا.

[دليل الاستخدام الكامل](docs/narrative-guide.md) · [البنية وحدود التحقق](docs/NARRATIVE-ARCHITECTURE.md)

## الإمكانات

- استيراد TXT وMarkdown بترميز UTF-8، مع حفظ النص ومواضع المقاطع وبصمة المصدر؛ يدعم العربية والإنجليزية.
- البحث الحرفي والقراءة المرتبة على صفحات، والتحقق من تطابق الاقتباس وموضعه.
- حفظ الملاحظات والاستنتاجات والفرضيات بأدلتها والأدلة المعارضة.
- تسجيل منظور المشهد وأهدافه وتغير المعرفة والقرار والنتيجة والاعتماد على مشاهد أخرى.
- تسجيل آليات بناء بشروط وخطوات وتفسيرات منافسة وتنبؤات واختبارات وقيود مجردة للنقل إلى عمل جديد.
- تتبع العلاقات المعلنة، وإبقاء المجهولات ظاهرة، وفحص سلامة التحقيق وتغطية التعليقات.
- تصدير التحقيق واستيراده على جهاز آخر، وإعداد موجز نقل يستبعد المقاطع الأصلية ويعرض القيود التي أدخلها المحلل.

## الحدود

المساعد المتصل هو الذي يقرأ ويفسر ويكتب إذا طلبت ذلك. هذه الحزمة لا تحتوي نموذج لغة ولا تولّد رواية بمفردها. صحة الاقتباس لا تثبت صحة تفسيره؛ الآليات تظل فرضيات غير مختبرة، ولا توجد تجربة قراء أو شهادة جودة أدبية مدمجة.

لا يوجد استيراد EPUB أو PDF أو DOCX أو OCR حاليًا. التحويل إلى نص يتم خارج المشروع مع مراجعة ترتيب النص. الحد لكل ملف أو تحقيق محفوظ هو 16 MiB؛ التحقيق يحتفظ بالنص ومقاطعه وأدلته، ولذلك قد تحتاج الكتب الطويلة إلى تقسيم. عناوين الفصول وتقسيم الفقرات تقريبيان، ولا يثبتان حدود المشاهد.

البيانات محلية في --home، أو .rea-narrative داخل مجلد التشغيل. ملف التصدير يتضمن نص الكتاب كاملًا؛ انقله بصورة خاصة. رفع البرنامج إلى GitHub لا يرفع كتبك وتحقيقاتك تلقائيًا.

## English

REA Narrative is a dependency-free Node.js 24+ CLI and stdio MCP server for evidence-centered investigation of novels. Your assistant supplies interpretation; the runtime preserves source identity, checks exact citations, stores narrative records, traces declared dependencies and exports portable investigations. It does not recover authorial intent or guarantee literary quality.

MIT. Original REA attribution is retained. Upstream package metadata, README and contributor guidance are archived under docs/upstream/. Historical software source is not covered by narrative tests. Do not merge upstream package or publishing configuration blindly into this fork.
