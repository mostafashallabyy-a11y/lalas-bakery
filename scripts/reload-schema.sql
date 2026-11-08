delete from rate_log;
notify pgrst_ddl_watch;
select 'done' as status;
