package org.example

import kotlinx.coroutines.Job
import org.example.models.JobResult
import org.example.models.JobStatus
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.FileTime

class ConversionLifecycleTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    fun `concurrent jobs receive isolated output directories`() {
        val first = Converter.jobOutputDirectory("job-a", tempDir.toString())
        val second = Converter.jobOutputDirectory("job-b", tempDir.toString())

        assertNotEquals(first, second)
        assertEquals(tempDir.resolve("job-a"), first)
        assertEquals(tempDir.resolve("job-b"), second)
    }

    @Test
    fun `missing and empty artifacts are rejected`() {
        val output = Files.createDirectory(tempDir.resolve("job"))
        val startedAt = FileTime.fromMillis(System.currentTimeMillis())

        assertThrows(IllegalArgumentException::class.java) {
            Converter.validateArtifacts("input.pdf", output, startedAt)
        }

        Files.writeString(output.resolve("input.md"), "")
        Files.writeString(output.resolve("input.json"), "{}")
        assertThrows(IllegalArgumentException::class.java) {
            Converter.validateArtifacts("input.pdf", output, startedAt)
        }
    }

    @Test
    fun `stale artifacts are rejected and fresh artifacts pass`() {
        val output = Files.createDirectory(tempDir.resolve("job"))
        val markdown = Files.writeString(output.resolve("input.md"), "content")
        val json = Files.writeString(output.resolve("input.json"), "{}")
        val startedAt = FileTime.fromMillis(System.currentTimeMillis())
        val stale = FileTime.fromMillis(startedAt.toMillis() - 10_000)
        Files.setLastModifiedTime(markdown, stale)
        Files.setLastModifiedTime(json, stale)

        assertThrows(IllegalArgumentException::class.java) {
            Converter.validateArtifacts("input.pdf", output, startedAt)
        }

        val fresh = FileTime.fromMillis(startedAt.toMillis() + 1_000)
        Files.setLastModifiedTime(markdown, fresh)
        Files.setLastModifiedTime(json, fresh)
        val artifacts = Converter.validateArtifacts("input.pdf", output, startedAt)
        assertEquals(markdown, artifacts.markdown)
        assertEquals(json, artifacts.json)
    }

    @Test
    fun `cancelled job cannot be overwritten by a late completion and retry is independent`() {
        val cancelledId = JobManager.createJob()
        val running = Job()
        JobManager.attachJob(cancelledId, running)
        JobManager.markRunning(cancelledId)

        assertTrue(JobManager.cancelJob(cancelledId))
        assertFalse(running.isActive)
        JobManager.markDone(cancelledId, JobResult(cancelledId, JobStatus.DONE.name))
        assertEquals(JobStatus.CANCELLED, JobManager.getStatus(cancelledId))

        val retryId = JobManager.createJob()
        JobManager.markRunning(retryId)
        JobManager.markDone(retryId, JobResult(retryId, JobStatus.DONE.name))
        assertEquals(JobStatus.DONE, JobManager.getStatus(retryId))
    }
}
