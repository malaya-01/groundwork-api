import { MigrationInterface, QueryRunner } from "typeorm";

export class Init1794983020738 implements MigrationInterface {
    name = 'Init1794983020738'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "groundwork"."app_user" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "username" text NOT NULL, "password_hash" text NOT NULL, "settings" jsonb NOT NULL DEFAULT '{}'::jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_c480e576dd71729addbc2d51b67" UNIQUE ("username"), CONSTRAINT "PK_22a5c4a3d9b2fb8e4e73fc4ada1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "groundwork"."map" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "title" text NOT NULL, "description" text NOT NULL DEFAULT '', "area" text NOT NULL DEFAULT 'other', "archived" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_df65ff7e281f7c5426d3e6476e" CHECK ("area" IN ('career','body','mind','money','other')), CONSTRAINT "PK_3b08de72489b3d4471b74516819" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "groundwork"."node" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "map_id" uuid NOT NULL, "kind" text NOT NULL DEFAULT 'task', "title" text NOT NULL, "notes" text NOT NULL DEFAULT '', "status" text NOT NULL DEFAULT 'todo', "estimate_hours" numeric(7,2), "due_date" date, "x" double precision NOT NULL DEFAULT '0', "y" double precision NOT NULL DEFAULT '0', "completed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_8cdd803ef105eaaeff3afcfce0" CHECK ("estimate_hours" >= 0), CONSTRAINT "CHK_fefe0fef3880bd6306675fefe2" CHECK ("status" IN ('todo','in_progress','done','dropped')), CONSTRAINT "CHK_77efe9ffac3cf5d50b2375cee3" CHECK ("kind" IN ('goal','milestone','skill','task','habit','resource','note')), CONSTRAINT "PK_8c8caf5f29d25264abe9eaf94dd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_713cc0b399aa14b01967344ead" ON "groundwork"."node" ("map_id") `);
        await queryRunner.query(`CREATE TABLE "groundwork"."edge" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "map_id" uuid NOT NULL, "source_id" uuid NOT NULL, "target_id" uuid NOT NULL, "kind" text NOT NULL DEFAULT 'requires', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "edge_source_target_kind" UNIQUE ("source_id", "target_id", "kind"), CONSTRAINT "CHK_990be856d6443d3d18aa40837e" CHECK ("kind" IN ('requires','relates')), CONSTRAINT "CHK_b8dfde0c340280856d7510152f" CHECK ("source_id" <> "target_id"), CONSTRAINT "PK_bf6f43c9af56d05094d8c57b311" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_58a874847a9ac2bd511b597df6" ON "groundwork"."edge" ("target_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_607ea5cb3671a6c6bdc9d57765" ON "groundwork"."edge" ("map_id") `);
        await queryRunner.query(`CREATE TABLE "groundwork"."daily_log" ("log_date" date NOT NULL, "floor_code" boolean NOT NULL DEFAULT false, "floor_walk" boolean NOT NULL DEFAULT false, "floor_page" boolean NOT NULL DEFAULT false, "woke" text NOT NULL DEFAULT '', "slept_hours" numeric(3,1), "one_thing" text NOT NULL DEFAULT '', "study_topic" text NOT NULL DEFAULT '', "study_minutes" integer, "ai_used" boolean, "learned" text NOT NULL DEFAULT '', "stuck" text NOT NULL DEFAULT '', "problems" jsonb NOT NULL DEFAULT '[]'::jsonb, "meals" jsonb NOT NULL DEFAULT '{}'::jsonb, "walk_minutes" integer, "physio" boolean NOT NULL DEFAULT false, "meds" jsonb NOT NULL DEFAULT '{}'::jsonb, "pain" smallint, "breathless" boolean, "breathless_note" text NOT NULL DEFAULT '', "win" text NOT NULL DEFAULT '', "tomorrow_first" text NOT NULL DEFAULT '', "mood" smallint, "notes" text NOT NULL DEFAULT '', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_e27fc7d940089c66b06a253e37" CHECK ("mood" BETWEEN 1 AND 5), CONSTRAINT "CHK_d373dc2ebfd25e718315cac2ca" CHECK ("pain" BETWEEN 0 AND 10), CONSTRAINT "CHK_9e24c065cd995b066711783fd4" CHECK ("walk_minutes" >= 0), CONSTRAINT "CHK_5f1678f2a8fa017dcb81b997bc" CHECK ("study_minutes" >= 0), CONSTRAINT "CHK_5fb49305174318ab907d656180" CHECK ("slept_hours" >= 0 AND "slept_hours" <= 24), CONSTRAINT "PK_9e86934bdede6be606cbeb7f746" PRIMARY KEY ("log_date"))`);
        await queryRunner.query(`CREATE TABLE "groundwork"."wave" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "log_date" date NOT NULL, "position" smallint NOT NULL DEFAULT '0', "code" text NOT NULL, "at_time" text NOT NULL DEFAULT '', "triggers" text array NOT NULL DEFAULT '{}', "action" text NOT NULL DEFAULT '', "outcome" text NOT NULL, CONSTRAINT "CHK_fc597b0cc0ef468ec9af1941ed" CHECK ("outcome" IN ('rode','wiped')), CONSTRAINT "CHK_d4117e6116288891c0929b49b3" CHECK ("code" IN ('a','b')), CONSTRAINT "PK_07d28eef1d84d7bfc8cbd86339c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_40756af3dba3b38ae5b222b493" ON "groundwork"."wave" ("log_date") `);
        await queryRunner.query(`CREATE TABLE "groundwork"."weekly_review" ("week_start" date NOT NULL, "answers" jsonb NOT NULL DEFAULT '{}'::jsonb, "spent" numeric(12,2), "sent_saved" numeric(12,2), "confidence_reps" integer, "notes" text NOT NULL DEFAULT '', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_c3cd3ed935c81f6db811024519" CHECK ("confidence_reps" >= 0), CONSTRAINT "PK_88ca3ee3d0f8f5145fcf4c6104e" PRIMARY KEY ("week_start"))`);
        await queryRunner.query(`CREATE TABLE "groundwork"."monthly_review" ("month" date NOT NULL, "answers" jsonb NOT NULL DEFAULT '{}'::jsonb, "scorecard" jsonb NOT NULL DEFAULT '{}'::jsonb, "notes" text NOT NULL DEFAULT '', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2e09af4342bbd383d3da4bba2dd" PRIMARY KEY ("month"))`);
        await queryRunner.query(`CREATE TABLE "groundwork"."yearly_review" ("year" integer NOT NULL, "answers" jsonb NOT NULL DEFAULT '{}'::jsonb, "notes" text NOT NULL DEFAULT '', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_05ca6cc13302d9350f66e11b19" CHECK ("year" BETWEEN 2000 AND 2200), CONSTRAINT "PK_3419836ee7a391af3a9bc941e76" PRIMARY KEY ("year"))`);
        await queryRunner.query(`CREATE TABLE "groundwork"."metric_entry" ("key" text NOT NULL, "recorded_on" date NOT NULL, "value" numeric NOT NULL, CONSTRAINT "CHK_895325c45e0bae230985ecb15c" CHECK ("key" ~ '^[a-z_]{2,30}$'), CONSTRAINT "PK_33b8deef7c9e6d79600ba498e07" PRIMARY KEY ("key", "recorded_on"))`);
        await queryRunner.query(`ALTER TABLE "groundwork"."node" ADD CONSTRAINT "FK_713cc0b399aa14b01967344eadc" FOREIGN KEY ("map_id") REFERENCES "groundwork"."map"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "groundwork"."edge" ADD CONSTRAINT "FK_607ea5cb3671a6c6bdc9d577652" FOREIGN KEY ("map_id") REFERENCES "groundwork"."map"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "groundwork"."edge" ADD CONSTRAINT "FK_4708cdd02336d7adcc0c1caa826" FOREIGN KEY ("source_id") REFERENCES "groundwork"."node"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "groundwork"."edge" ADD CONSTRAINT "FK_58a874847a9ac2bd511b597df68" FOREIGN KEY ("target_id") REFERENCES "groundwork"."node"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "groundwork"."wave" ADD CONSTRAINT "FK_40756af3dba3b38ae5b222b4932" FOREIGN KEY ("log_date") REFERENCES "groundwork"."daily_log"("log_date") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "groundwork"."wave" DROP CONSTRAINT "FK_40756af3dba3b38ae5b222b4932"`);
        await queryRunner.query(`ALTER TABLE "groundwork"."edge" DROP CONSTRAINT "FK_58a874847a9ac2bd511b597df68"`);
        await queryRunner.query(`ALTER TABLE "groundwork"."edge" DROP CONSTRAINT "FK_4708cdd02336d7adcc0c1caa826"`);
        await queryRunner.query(`ALTER TABLE "groundwork"."edge" DROP CONSTRAINT "FK_607ea5cb3671a6c6bdc9d577652"`);
        await queryRunner.query(`ALTER TABLE "groundwork"."node" DROP CONSTRAINT "FK_713cc0b399aa14b01967344eadc"`);
        await queryRunner.query(`DROP TABLE "groundwork"."metric_entry"`);
        await queryRunner.query(`DROP TABLE "groundwork"."yearly_review"`);
        await queryRunner.query(`DROP TABLE "groundwork"."monthly_review"`);
        await queryRunner.query(`DROP TABLE "groundwork"."weekly_review"`);
        await queryRunner.query(`DROP INDEX "groundwork"."IDX_40756af3dba3b38ae5b222b493"`);
        await queryRunner.query(`DROP TABLE "groundwork"."wave"`);
        await queryRunner.query(`DROP TABLE "groundwork"."daily_log"`);
        await queryRunner.query(`DROP INDEX "groundwork"."IDX_607ea5cb3671a6c6bdc9d57765"`);
        await queryRunner.query(`DROP INDEX "groundwork"."IDX_58a874847a9ac2bd511b597df6"`);
        await queryRunner.query(`DROP TABLE "groundwork"."edge"`);
        await queryRunner.query(`DROP INDEX "groundwork"."IDX_713cc0b399aa14b01967344ead"`);
        await queryRunner.query(`DROP TABLE "groundwork"."node"`);
        await queryRunner.query(`DROP TABLE "groundwork"."map"`);
        await queryRunner.query(`DROP TABLE "groundwork"."app_user"`);
    }

}
